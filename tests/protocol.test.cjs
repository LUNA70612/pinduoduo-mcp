'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
test('invalid JSON-RPC request and unknown tools have correct errors', async () => {
  const { handle } = require('../server.cjs');
  assert.equal((await handle({ jsonrpc: '1.0', id: 1, method: 'ping' })).error.code, -32600);
  assert.equal((await handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'missing' } })).error.code, -32602);
});
test('initialize advertises standard tool change capability and output schemas', async () => {
  const { handle } = require('../server.cjs');
  const initialized = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(initialized.result.capabilities.tools.listChanged, true);
  assert.match(initialized.result.instructions||'',/90 秒/);
  assert.match(initialized.result.instructions||'',/price_assessment/);
  const listed = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.equal(listed.result.tools.length, 10);
  for (const tool of listed.result.tools) {
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.outputSchema.type, 'object');
    assert.ok(tool.outputSchema.required.includes('status'));
  }
});
test('semantic input errors use -32602, unsupported cursor uses structured business error', async () => {
  const { handle } = require('../server.cjs');
  const call = (name, args) => handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } });
  assert.equal((await call('pdd_read_item', { url: 'https://evil.test/?goods_id=123' })).error.code, -32602);
  const cursor = await call('pdd_read_cart', { cursor: 'next' });
  assert.equal(cursor.result.structuredContent.status, 'unsupported');
  assert.equal(cursor.result.isError, true);
});
test('timeouts return a schema-compliant error and resumable read without retrying', async t => {
  const fs = require('node:fs'), path = require('node:path');
  const base = path.join(__dirname, '..', 'work', 'protocol-operations');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'timeout-'));
  const operationStore = require('../tools/operations.cjs').createOperations({ dir });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pdd = require('../tools/pdd.cjs');
  const original = pdd.search;
  let attempts = 0;
  pdd.search = async () => { attempts++; throw Object.assign(Error('timeout'), { code: 'TIMEOUT' }); };
  t.after(() => { pdd.search = original; });
  const response = await require('../server.cjs').handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'pdd_search', arguments: { query: '测试' } } }, operationStore);
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.status, 'timeout');
  assert.equal(typeof response.result.structuredContent.resume_id, 'string');
  assert.equal(response.result.structuredContent.waiting_for_user, false);
  assert.equal(response.result.structuredContent.execution_ended, false);
  assert.equal(attempts, 1);
  assert.equal(operationStore.summary().recoverable, 1);
  pdd.validateSchema(pdd.tools.find(tool => tool.name === 'pdd_search').outputSchema, response.result.structuredContent);
});
test('real stdio transport supports restart, disconnect status and clean protocol output', async () => {
  const { createStdioClient } = require('../tools/stdio-client.cjs');
  for (let run = 0; run < 2; run++) {
    const client = createStdioClient({ env: { ...process.env, OPENCLI_CDP_ENDPOINT: 'http://127.0.0.1:65534', PDD_ENABLE_WRITES: '0', PDD_WRITE_TEST_MODE: '0' }, timeout: 10000 });
    try {
      const init = await client.request('initialize', { protocolVersion: '2025-03-26', clientInfo: { name: 'test', version: '1' }, capabilities: {} });
      assert.equal(init.result.serverInfo.name, 'pinduoduo-mcp');
      client.notify('notifications/initialized');
      const data = await client.request('tools/call', { name: 'pdd_status', arguments: {} });
      assert.equal(data.result.structuredContent.status, 'ok');
      assert.equal(data.result.structuredContent.browser_connected, false);
      assert.equal(data.result.structuredContent.writes_enabled, false);
      assert.deepEqual(JSON.parse(data.result.content[0].text), data.result.structuredContent);
      assert.equal((await client.request('missing')).error.code, -32601);
    } finally { client.close(); }
  }
});
test('tool schemas reject extra fields and invalid limit without browsing', async () => {
  const { handle } = require('../server.cjs');
  const message = args => ({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'pdd_search', arguments: args } });
  assert.equal((await handle(message({ query: '耳机', unexpected: true }))).error.code, -32602);
  assert.equal((await handle(message({ query: '耳机', limit: 1.5 }))).error.code, -32602);
  assert.equal((await handle(message(JSON.parse('{"query":"耳机","toString":"extra"}')))).error.code, -32602);
});
test('stdout parse errors, notifications and business errors remain protocol messages', async () => {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, [require('node:path').resolve(__dirname, '..', 'server.cjs')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  child.stdout.on('data', bytes => { output += bytes; });
  const complete = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error(`server exit ${code}`))); });
  child.stdin.end('not-json\n' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n' + JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
  await complete;
  const messages = output.trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(messages.length, 2);
  assert.equal(messages.find(message => message.id === null).error.code, -32700);
  assert.deepEqual(messages.find(message => message.id === 1).result, {});
});
test('client preserves CLI parse errors and maps structured argument names', async () => {
  const { createClient } = require('../tools/pdd.cjs');
  assert.equal(typeof createClient, 'function');
  const client = createClient({ invoke: async () => ({ stdout: 'garbage' }) });
  await assert.rejects(client.search({ query: '耳机' }), /JSON/);
});
test('child environment isolates files without deprecated daemon port', () => {
  const { childEnv } = require('../tools/pdd.cjs');
  const env = childEnv({ PATH: 'path', OPENCLI_DAEMON_PORT: '19825', OPENCLI_CDP_TARGET: '个人中心', UNKNOWN_SECRET: 'do-not-copy' });
  assert.equal(env.OPENCLI_DAEMON_PORT, undefined);
  assert.equal(env.UNKNOWN_SECRET, undefined);
  assert.equal(env.OPENCLI_CDP_TARGET, '个人中心');
  assert.equal(env.USERPROFILE, require('node:path').resolve(__dirname, '..', 'runtime', 'home'));
});

test('OpenCLI command deadline includes the project 90 second cooldown', async () => {
  const { childEnv } = require('../tools/pdd.cjs');
  const { execFile } = require('node:child_process');
  const { promisify } = require('node:util');
  const previous = process.env.OPENCLI_BROWSER_COMMAND_TIMEOUT;
  const env = childEnv();
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', "import {DEFAULT_BROWSER_COMMAND_TIMEOUT as seconds} from './node_modules/@jackwener/opencli/dist/src/browser/config.js'; console.log(seconds)"], { cwd: require('node:path').join(__dirname, '..'), env });
  assert.equal(Number(result.stdout.trim()), 180);
  assert.equal(process.env.OPENCLI_BROWSER_COMMAND_TIMEOUT, previous);
});
test('corrupted write response is unknown and never automatically retried', async t => {
  const previous = { enabled: process.env.PDD_ENABLE_WRITES, mode: process.env.PDD_WRITE_TEST_MODE };
  process.env.PDD_ENABLE_WRITES = '1'; process.env.PDD_WRITE_TEST_MODE = '1';
  t.after(() => { for (const [key, value] of [['PDD_ENABLE_WRITES', previous.enabled], ['PDD_WRITE_TEST_MODE', previous.mode]]) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  let attempts = 0; let sent;
  const client = require('../tools/pdd.cjs').createClient({ invoke: async args => { attempts++; sent = args; return { stdout: 'bad output' }; } });
  const data = await client.addCart({ goods_id: '123', quantity: 1, sku_index: 0, confirm: true, request_id: 'unknown-0001', spec_selection: { 颜色: '红' } });
  assert.equal(data.status, 'result_unknown');
  assert.equal(attempts, 1);
  assert.ok(sent.includes('--sku_index'));
  assert.ok(!sent.includes('--sku-index'));
  assert.ok(sent.includes('--spec_selection'));
  const failed = pddClientWithFailure();
  const unknown = await failed.addCart({ goods_id: '123', confirm: true, request_id: 'unknown-exit-0001' });
  assert.equal(unknown.status, 'result_unknown');
  function pddClientWithFailure() { return require('../tools/pdd.cjs').createClient({ invoke: async () => { throw Object.assign(Error('child failed'), { stdout: 'corrupted failure', code: 1 }); } }); }
});
