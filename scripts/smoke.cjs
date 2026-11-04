'use strict';
const assert = require('node:assert/strict');
const { createStdioClient } = require('../tools/stdio-client.cjs');
(async () => {
  const client = createStdioClient({ timeout: 10000, env: { ...process.env, PDD_ENABLE_WRITES: '0', PDD_WRITE_TEST_MODE: '0' } });
  try {
    const init = await client.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'pdd-smoke', version: '1' } });
    assert.equal(init.result.capabilities.tools.listChanged, true);
    client.notify('notifications/initialized');
    const list = await client.request('tools/list');
    assert.equal(list.result.tools.length, 10);
    assert.ok(list.result.tools.every(tool => tool.outputSchema && tool.annotations));
    const gate = await client.request('tools/call', { name: 'pdd_add_cart', arguments: { goods_id: '123' } });
    assert.equal(gate.result.structuredContent.status, 'awaiting_confirmation');
    assert.deepEqual((await client.request('ping')).result, {});
    console.log('MCP smoke passed: initialize, 10 tools with schemas, write confirmation gate, ping');
  } finally { client.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
