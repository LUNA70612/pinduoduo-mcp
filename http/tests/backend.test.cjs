'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const types = require('@modelcontextprotocol/sdk/types.js');
const { createCoreBackend } = require('../backend.cjs');
async function peer(t) {
  const base = path.resolve(__dirname, '../../work/http-backend-tests'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'case-'));
  fs.copyFileSync(path.join(__dirname, 'fixtures/stdio-core.cjs'), path.join(root, 'server.cjs'));
  const faults = [];
  const backend = await createCoreBackend({ root, env: { ...process.env, PDD_ENABLE_WRITES: '1', PDD_WRITE_TEST_MODE: '1', PDD_HTTP_TEST_SECRET: 'secret' }, onFault: reason => faults.push(reason) });
  t.after(async () => { await backend.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { backend, faults };
}
test('real SDK backend tracks a late response after timeout and waits before shutdown', async t => {
  const { backend } = await peer(t);
  await assert.rejects(backend.request({ method: 'tools/call', params: { name: 'slow', arguments: {} } }, types.CallToolResultSchema, { timeout: 20 }), error => error.code === types.ErrorCode.RequestTimeout);
  assert.equal(backend.isExecuting(), true);
  await backend.waitIdle();
  assert.equal(backend.isExecuting(), false);
  const result = await backend.request({ method: 'tools/call', params: { name: 'slow', arguments: {} } }, types.CallToolResultSchema, { timeout: 1000 });
  assert.equal(result.structuredContent.calls, 2, 'timeout was not automatically replayed');
  assert.equal(result.structuredContent.writes, '0');
  assert.equal(result.structuredContent.test_mode, '0');
  assert.equal(result.structuredContent.http_secret_inherited, false);
});
test('unexpected synthetic child exit wakes pending requests and idle cleanup', async t => {
  const { backend, faults } = await peer(t);
  const pending = backend.request({ method: 'tools/call', params: { name: 'slow', arguments: {} } }, types.CallToolResultSchema, { timeout: 1000 });
  const rejected = assert.rejects(pending);
  process.kill(backend.pid);
  await rejected; await backend.waitIdle();
  assert.equal(backend.isExecuting(), false);
  assert.ok(faults.includes('core_exited'));
});
