'use strict';
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

// One real, unchanged stdio service per HTTP session. No page logic lives here.
async function createCoreBackend({ root, env = process.env, onFault = () => {} }) {
  const childEnv = Object.fromEntries(Object.entries(env).filter(([, value]) => typeof value === 'string'));
  for (const name of Object.keys(childEnv)) if (/^PDD_HTTP_/i.test(name)) delete childEnv[name];
  childEnv.PDD_ENABLE_WRITES = '0'; childEnv.PDD_WRITE_TEST_MODE = '0';
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'server.cjs')], cwd: root, env: childEnv, stderr: 'pipe' });
  transport.stderr?.resume(); // Drain without copying unredacted child diagnostics to HTTP logs.
  const client = new Client({ name: 'pinduoduo-local-http-bridge', version: '0.1.0' }, { capabilities: {} });
  let closing = false, ended = false;
  const outstanding = new Set(), idleWaiters = new Set();
  const notifyIdle = () => { if (!outstanding.size || ended) { for (const resolve of idleWaiters) resolve(); idleWaiters.clear(); } };
  const send = transport.send.bind(transport);
  transport.send = async message => {
    if (message.method && Object.hasOwn(message, 'id')) outstanding.add(message.id);
    try { await send(message); } catch (error) { outstanding.delete(message.id); notifyIdle(); throw error; }
  };
  client.onclose = () => { ended = true; outstanding.clear(); notifyIdle(); if (!closing) onFault('core_exited'); };
  client.onerror = () => { if (!closing) onFault('core_protocol_error'); };
  try { await client.connect(transport, { timeout: 30000 }); }
  catch { closing = true; await client.close().catch(() => {}); throw Error('原 stdio 服务初始化失败；请先检查原服务安装。'); }
  outstanding.clear();
  const receive = transport.onmessage;
  transport.onmessage = (message, extra) => {
    if (!message.method && Object.hasOwn(message, 'id')) { outstanding.delete(message.id); notifyIdle(); }
    receive?.(message, extra);
  };
  const waitIdle = () => outstanding.size && !ended ? new Promise(resolve => idleWaiters.add(resolve)) : Promise.resolve();
  return {
    info: client.getServerVersion(), capabilities: client.getServerCapabilities(), instructions: client.getInstructions(), pid: transport.pid,
    request: (request, schema, options) => client.request(request, schema, options),
    isExecuting: () => outstanding.size > 0 && !ended,
    waitIdle,
    async close() { await waitIdle(); closing = true; await client.close(); },
  };
}
module.exports = { createCoreBackend };
