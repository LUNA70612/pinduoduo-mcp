'use strict';
// Synthetic stdio peer for timeout/exit tests. Never touches browsers or files.
const readline = require('node:readline');
const input = readline.createInterface({ input: process.stdin });
let calls = 0;
input.on('line', async line => {
  const request = JSON.parse(line);
  if (!Object.hasOwn(request, 'id')) return;
  let result = {};
  if (request.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {}, prompts: {} }, serverInfo: { name: 'synthetic-timeout-peer', version: 'test' } };
  if (request.method === 'tools/call') {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 180));
    result = { content: [{ type: 'text', text: String(calls) }], structuredContent: { status: 'ok', calls, writes: process.env.PDD_ENABLE_WRITES, test_mode: process.env.PDD_WRITE_TEST_MODE, http_secret_inherited: !!process.env.PDD_HTTP_TEST_SECRET } };
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
