'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { start, connect, rpc, headers, delay } = require('./helpers.cjs');

test('two official SDK HTTP connections keep all 10 tools, 3 prompts and original errors', async t => {
  const { url, gateway } = await start(t, { real: true, env: { ...process.env, OPENCLI_CDP_ENDPOINT: 'http://127.0.0.1:65534', PDD_ENABLE_WRITES: '1', PDD_WRITE_TEST_MODE: '1' } });
  for (let run = 0; run < 2; run++) {
    const { client, transport } = await connect(t, url);
    assert.equal(client.getInstructions(), require('../../tools/shopping-prompts.cjs').instructions);
    assert.match(client.getInstructions(), /默认组合已核价不等于符合目标型号/);
    const tools = await client.listTools(); assert.equal(tools.tools.length, 10);
    assert.ok(tools.tools.every(tool => tool.outputSchema && tool.annotations));
    const prompts = (await client.listPrompts()).prompts;
    assert.equal(prompts.length, 3);
    for (const prompt of prompts) {
      const args = { name: prompt.name, arguments: { request: '找便宜的5600GT CPU' } };
      const actual = await client.getPrompt(args);
      assert.deepEqual(actual, require('../../tools/shopping-prompts.cjs').getPrompt(args));
      assert.match(actual.messages[0].content.text, /不能用商品最低价.*目标型号参考价/);
    }
    assert.equal((await client.getPrompt({ name: 'pdd_earphones', arguments: { request: '200元内，续航优先' } })).messages.length, 2);
    const status = await client.callTool({ name: 'pdd_status', arguments: {} });
    assert.equal(status.structuredContent.browser_connected, false);
    assert.equal(status.structuredContent.writes_enabled, false);
    assert.equal(status.structuredContent.login_status, 'not_checked');
    assert.deepEqual(JSON.parse(status.content[0].text), status.structuredContent);
    const business = await client.callTool({ name: 'pdd_read_cart', arguments: { cursor: 'next' } });
    assert.equal(business.isError, true); assert.equal(business.structuredContent.status, 'unsupported');
    await assert.rejects(client.callTool({ name: 'pdd_read_item', arguments: { url: 'https://evil.test/?goods_id=1' } }), error => error.code === -32602);
    const denied = await client.callTool({ name: 'pdd_add_cart', arguments: { goods_id: '123', confirm: true, request_id: 'http-write-denied' } });
    assert.equal(denied.isError, true);
    await client.ping();
    await transport.terminateSession(); await client.close();
  }
  assert.equal(gateway.sessions.size, 0);
});

test('same HTTP session preserves source, while another session cannot borrow candidates', async t => {
  const { url, tracker } = await start(t);
  const a = await connect(t, url), b = await connect(t, url);
  await a.client.callTool({ name: 'pdd_search', arguments: { query: '耳机' } });
  const item = await a.client.callTool({ name: 'pdd_read_item', arguments: { url: '123', include_product_images: true } });
  assert.equal(item.structuredContent.marker, 'unaltered');
  assert.equal(item.structuredContent.price_assessment.reference_price, 86);
  assert.deepEqual(item.structuredContent.price_assessment.unknowns, ['运费未知']);
  assert.equal(item.content[1].type, 'image');
  const other = await b.client.callTool({ name: 'pdd_read_item', arguments: { url: '123' } });
  assert.equal(other.structuredContent.diagnostic, 'search_context_missing');
  assert.equal(tracker.created.length, 2);
});

test('unauthorized, hostile Host/Origin, query tokens, malformed JSON and unknown sessions never spawn core', async t => {
  const { url, tracker } = await start(t);
  for (const entry of [
    [{}, 401],
    [{ ...headers, Authorization: 'Bearer bad' }, 401],
    [{ ...headers, Origin: 'https://evil.example' }, 403],
    [{ ...headers, Origin: 'null' }, 403],
  ]) {
    const response = await fetch(url, { method: 'POST', headers: entry[0], body: '{}' });
    assert.equal(response.status, entry[1]);
  }
  const hostileHost = await new Promise((resolve, reject) => {
    const request = require('node:http').request(url, { method: 'POST', headers: { ...headers, Host: 'evil.example' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject); request.end('{}');
  });
  assert.equal(hostileHost, 403);
  assert.equal((await fetch(`${url}?token=private`, { headers })).status, 404);
  assert.equal((await fetch(url, { method: 'POST', headers, body: 'bad json' })).status, 400);
  assert.equal((await rpc(url, 'unknown', 1, 'ping', {})).status, 404);
  assert.equal((await fetch(url, { method: 'GET', headers })).status, 400);
  assert.equal((await fetch(url, { method: 'PUT', headers })).status, 405);
  assert.equal(tracker.created.length, 0);
  assert.equal(JSON.stringify(tracker.events).includes('private'), false);
});

test('idle expiry discards context and requires explicit initialization and search', async t => {
  let time = 0;
  const { url, gateway, tracker } = await start(t, { now: () => time, config: { idleTimeout: 100 } });
  const { transport } = await connect(t, url);
  const id = transport.sessionId;
  time = 101;
  await gateway.sweep();
  assert.equal(gateway.sessions.size, 0); assert.equal(tracker.created[0].closed, true);
  assert.equal((await rpc(url, id, 44, 'ping', {})).status, 404);
});

test('duplicate in-flight ID and concurrent page calls are rejected without replay', async t => {
  const { url, tracker } = await start(t, { fake: { delayMs: 200 } });
  const { transport } = await connect(t, url);
  const first = rpc(url, transport.sessionId, 73, 'tools/call', { name: 'pdd_search', arguments: { query: 'delay' } });
  while (!tracker.created[0].pending.size) await delay(5);
  const duplicate = await rpc(url, transport.sessionId, 73, 'tools/call', { name: 'pdd_search', arguments: { query: 'delay' } });
  assert.equal(duplicate.status, 409);
  const concurrent = await rpc(url, transport.sessionId, 74, 'tools/call', { name: 'pdd_search', arguments: { query: 'other' } });
  assert.equal((await concurrent.json()).error.code, -32000);
  assert.equal((await (await first).json()).result.structuredContent.status, 'ok');
  assert.equal(tracker.created[0].calls.filter(call => call.params?.name === 'pdd_search').length, 1);
});

test('an aborted HTTP response does not kill or replay the original call', async t => {
  const { url, tracker } = await start(t, { fake: { delayMs: 150 } });
  const { transport } = await connect(t, url);
  const controller = new AbortController();
  const response = fetch(url, { method: 'POST', headers: { ...headers, 'Mcp-Session-Id': transport.sessionId }, signal: controller.signal, body: JSON.stringify({ jsonrpc: '2.0', id: 80, method: 'tools/call', params: { name: 'pdd_search', arguments: { query: 'delay' } } }) });
  while (!tracker.created[0].pending.size) await delay(5);
  controller.abort(); await assert.rejects(response);
  assert.equal(tracker.created[0].closed, false);
  while (tracker.created[0].pending.size) await delay(10);
  const item = await rpc(url, transport.sessionId, 81, 'tools/call', { name: 'pdd_read_item', arguments: { url: '123' } });
  assert.equal((await item.json()).result.structuredContent.marker, 'unaltered');
  assert.equal(tracker.created[0].calls.filter(call => call.params?.name === 'pdd_search').length, 1);
});

test('timeout blocks further page dispatch and closing waits for actual backend completion', async t => {
  const { url, tracker, gateway } = await start(t, { config: { requestTimeout: 25 }, fake: { delayMs: 180, simulateTimeout: true } });
  const { transport } = await connect(t, url);
  const result = await rpc(url, transport.sessionId, 90, 'tools/call', { name: 'pdd_search', arguments: { query: 'delay' } });
  assert.equal((await result.json()).error.code, -32000);
  const blocked = await rpc(url, transport.sessionId, 91, 'tools/call', { name: 'pdd_search', arguments: { query: 'again' } });
  assert.equal((await blocked.json()).error.code, -32000);
  const safeStatus = await rpc(url, transport.sessionId, 92, 'tools/call', { name: 'pdd_status', arguments: {} });
  assert.equal((await safeStatus.json()).result.structuredContent.status, 'ok');
  const closing = gateway.close(); await delay(10);
  assert.equal(tracker.created[0].closed, false);
  await closing;
  assert.equal(tracker.created[0].closed, true);
  assert.equal(tracker.created[0].calls.filter(call => call.params?.name === 'pdd_search').length, 1);
});

test('core exit prevents further page requests and closing releases the session', async t => {
  const { url, tracker } = await start(t);
  const { transport } = await connect(t, url);
  tracker.created[0].onFault('core_exited');
  const response = await rpc(url, transport.sessionId, 101, 'tools/call', { name: 'pdd_search', arguments: { query: '耳机' } });
  assert.equal((await response.json()).error.code, -32000);
  assert.equal(tracker.created[0].calls.length, 0);
  await transport.terminateSession();
  assert.equal(tracker.created[0].closed, true);
});

test('port conflicts never silently choose another endpoint', async t => {
  const first = await start(t);
  await assert.rejects(start(t, { config: { port: first.port } }), /已占用/);
});

test('shutdown during initialization waits for the new child and cannot leak a session', async t => {
  let releaseInitialization, entered = false;
  const held = new Promise(resolve => { releaseInitialization = resolve; });
  const tracker = {}, factory = require('./helpers.cjs').fakeFactory(tracker);
  const { url, gateway } = await start(t, { backendFactory: async options => { entered = true; await held; return factory(options); } });
  const connecting = fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'held-init', version: '1' } } }) });
  while (!entered) await delay(5);
  await gateway.sweep();
  const stopping = gateway.close();
  releaseInitialization();
  assert.equal((await connecting).status, 500);
  await stopping;
  assert.equal(tracker.created[0].closed, true);
  assert.equal(gateway.allSessions.size, 0);
  assert.equal(gateway.sessions.size, 0);
});
