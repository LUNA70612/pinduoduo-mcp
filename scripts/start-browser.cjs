'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

function portInUse(endpoint) {
  const url = new URL(endpoint);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port) });
    let settled = false;
    const finish = (error, occupied) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(occupied);
    };
    socket.once('connect', () => finish(null, true));
    socket.once('error', error => finish(error.code === 'ECONNREFUSED' ? null : Error('无法确认 CDP 端口是否空闲，请检查本机连接。'), false));
    socket.setTimeout(1000);
    socket.once('timeout', () => finish(Error('检查 CDP 端口超时；未启动浏览器。')));
  });
}

function validVersion(version, port) {
  if (!version || typeof version.Browser !== 'string' || !version.Browser.trim() || typeof version.webSocketDebuggerUrl !== 'string') return false;
  try {
    const url = new URL(version.webSocketDebuggerUrl);
    return ['ws:', 'wss:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      Number(url.port) === port && !url.username && !url.password && !url.search && !url.hash && /^\/devtools\/browser\/[^/]+$/.test(url.pathname);
  } catch { return false; }
}

(async () => {
  const config = require('../tools/config.cjs').browserConfig();
  const candidates = [
    config.browserPath,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ...(process.env.LOCALAPPDATA ? ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'].map(relative => path.join(process.env.LOCALAPPDATA, relative)) : [])
  ].filter(Boolean);
  const browser = candidates.find(fs.existsSync);
  if (!browser) throw Error('未找到 Chrome/Edge，请设置 PDD_BROWSER_PATH。');
  const profile = config.profile, port = config.port;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('PDD_DEBUG_PORT 必须是 1024-65535 的整数。');
  if (await portInUse(config.endpoint)) throw Error(`CDP 端口 ${port} 已被占用，未启动新浏览器。已有项目浏览器请检查配置后运行 npm.cmd run bind-browser。`);
  fs.mkdirSync(profile, { recursive: true });
  const args = [`--remote-debugging-port=${port}`, '--remote-allow-origins=*', '--window-size=390,844', `--user-data-dir=${profile}`, 'https://mobile.yangkeduo.com/'];
  // Preserve the browser's native desktop UA. Do not restore the old mobile override.
  const child = spawn(browser, args, { detached: true, stdio: 'ignore', windowsHide: false });
  let fail;
  const failed = new Promise((resolve, reject) => { fail = reject; });
  const onError = () => fail(Error('浏览器进程无法启动，请检查 PDD_BROWSER_PATH 和执行权限。'));
  const onExit = (code, signal) => fail(Error(`浏览器在 CDP 就绪前退出（exit=${code ?? signal ?? 'unknown'}）；请检查端口及 profile 是否已由其他浏览器使用。`));
  child.once('error', onError);
  child.once('exit', onExit);
  try {
    await Promise.race([new Promise(resolve => child.once('spawn', resolve)), failed]);
    child.unref();
    const deadline = Date.now() + 30000;
    let lastState = '尚未取得有效响应';
    while (Date.now() < deadline) {
      const ready = await Promise.race([
        (async () => {
          try {
            const response = await fetch(new URL('/json/version', config.endpoint), { signal: AbortSignal.timeout(Math.min(1000, deadline - Date.now())) });
            if (!response.ok || !validVersion(await response.json(), port)) { lastState = 'CDP 返回内容无效'; return false; }
            return true;
          } catch { lastState = 'CDP 暂不可达或响应无效'; return false; }
        })(), failed
      ]);
      if (ready) {
        console.log(`CDP 已就绪: ${path.basename(browser)} port=${port} profile=${profile}；登录状态未检查，请由使用者本人登录。`);
        return;
      }
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        let timer;
        try { await Promise.race([new Promise(resolve => { timer = setTimeout(resolve, Math.min(500, remaining)); }), failed]); }
        finally { clearTimeout(timer); }
      }
    }
    throw Error(`等待 CDP 就绪超过 30 秒（${lastState}）；未自动重启或关闭浏览器。请检查后使用 npm.cmd run bind-browser。`);
  } finally {
    child.removeListener('error', onError);
    child.removeListener('exit', onExit);
    child.unref();
  }
})().catch(error => { console.error(`浏览器启动失败：${error.message}`); process.exitCode = 1; });
