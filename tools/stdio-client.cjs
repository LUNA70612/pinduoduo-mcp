'use strict';
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const path = require('node:path');
function createStdioClient({ root = path.resolve(__dirname, '..'), env = process.env, timeout = 240000 } = {}) {
  const child = spawn(process.execPath, [path.join(root, 'server.cjs')], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const pending = new Map(); let next = 0; let stderr = ''; let closed = false;
  const fail = error => { closed = true; for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); } pending.clear(); };
  child.stdin.on('error', fail);
  child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-4096); });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    let value;
    try { value = JSON.parse(line); } catch { fail(Error('服务 stdout 包含非 JSON 协议内容。')); return; }
    if (value.jsonrpc !== '2.0') { fail(Error('服务返回无效 JSON-RPC。')); return; }
    const waiter = pending.get(value.id);
    if (waiter) { clearTimeout(waiter.timer); pending.delete(value.id); waiter.resolve(value); }
  });
  child.once('error', fail);
  child.once('exit', code => fail(Error(`MCP 服务退出：${code} ${stderr}`)));
  return {
    request(method, params = {}) {
      if (closed) return Promise.reject(Error('MCP 连接已关闭。'));
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(Error(`MCP ${method} 超时。`)); }, timeout);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    },
    notify(method, params = {}) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); },
    close() { fail(Error('客户端关闭。')); lines.close(); child.stdin.end(); child.kill(); },
  };
}
module.exports = { createStdioClient };
