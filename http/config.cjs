'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
function paths(root) {
  return { settings: path.join(root, 'runtime/http-config.local.json'), auth: path.join(root, 'runtime/http-auth.local.json'), connection: path.join(root, 'outputs/mcp-http.connection.local.json') };
}
function readJSON(file, optional = false) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (optional && error.code === 'ENOENT') return {}; throw Error('HTTP 本机配置缺失或损坏；请运行 npm run setup:http，既有令牌不会自动覆盖。'); }
}
function readConfig({ root = ROOT, env = process.env, requireToken = true } = {}) {
  const files = paths(root), saved = readJSON(files.settings, true);
  const value = env.PDD_HTTP_PORT ?? saved.port ?? 4176;
  if (!/^\d+$/.test(String(value)) || Number(value) < 1024 || Number(value) > 65535) throw Error('PDD_HTTP_PORT 必须是 1024–65535 的整数。');
  const port = Number(value);
  if (env.PDD_HTTP_HOST && env.PDD_HTTP_HOST !== '127.0.0.1') throw Error('HTTP 首轮仅允许监听 127.0.0.1。');
  const auth = requireToken ? readJSON(files.auth) : {};
  if (requireToken && (typeof auth.token !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(auth.token))) throw Error('HTTP 令牌格式无效，请人工检查本机 HTTP 配置。');
  return { root, host: '127.0.0.1', port, url: `http://127.0.0.1:${port}/mcp`, token: auth.token, requestTimeout: 300000, idleTimeout: 1800000, files };
}
function setupConfig({ root = ROOT, env = process.env } = {}) {
  const config = readConfig({ root, env, requireToken: false });
  fs.mkdirSync(path.join(root, 'runtime'), { recursive: true });
  fs.mkdirSync(path.join(root, 'outputs'), { recursive: true });
  if (!fs.existsSync(config.files.auth)) {
    fs.writeFileSync(config.files.auth, JSON.stringify({ token: crypto.randomBytes(32).toString('base64url') }) + '\n', { flag: 'wx', mode: 0o600 });
  }
  const checked = readConfig({ root, env });
  fs.writeFileSync(checked.files.settings, JSON.stringify({ host: checked.host, port: checked.port }, null, 2) + '\n', { mode: 0o600 });
  fs.writeFileSync(checked.files.connection, JSON.stringify({ transport: 'streamable-http', url: checked.url, headers: { Authorization: `Bearer ${checked.token}` }, tool_timeout_seconds: 300, note: '连接资料供客户端填写；不同客户端的导入格式可能不同。请勿上传或公开此文件。' }, null, 2) + '\n', { mode: 0o600 });
  return { status: 'ok', url: checked.url, connection_file: checked.files.connection, token: '[stored locally; not logged]' };
}
module.exports = { ROOT, paths, readConfig, setupConfig };
