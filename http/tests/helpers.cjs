'use strict';
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { McpError, ErrorCode } = require('@modelcontextprotocol/sdk/types.js');
const { createGateway } = require('../server.cjs');
const TOKEN = 'h'.repeat(43);
const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function fakeFactory(tracker = {}, options = {}) {
  tracker.created = []; tracker.events = [];
  return async ({ onFault }) => {
    const state = { calls: [], sources: new Set(), pending: new Set(), closed: false, onFault };
    tracker.created.push(state);
    const fixture = { content: [{ type: 'text', text: '商品图片（本地测试 fixture）' }, { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZ8AAAAASUVORK5CYII=' }], structuredContent: { status: 'ok', marker: 'unaltered', price_assessment: { reference_price: 86, conditions: ['券前价'], unknowns: ['运费未知'] } }, isError: false };
    return {
      info: { name: 'pinduoduo-mcp-test-core', version: 'test' }, capabilities: { tools: { listChanged: true }, prompts: {} }, instructions: 'fixture: same-session source; readonly; 90 秒',
      isExecuting: () => state.pending.size > 0,
      waitIdle: () => Promise.allSettled([...state.pending]),
      async close() { assert.equal(state.pending.size, 0, 'must not close a running backend'); state.closed = true; },
      request(request, _schema, settings) {
        state.calls.push(request);
        const actual = (async () => {
          if (request.params?.arguments?.query === 'delay') await delay(options.delayMs || 150);
          const method = request.method, name = request.params?.name, args = request.params?.arguments || {};
          if (method === 'tools/call') {
            if (name === 'pdd_status') return { content: [{ type: 'text', text: '{"status":"ok"}' }], structuredContent: { status: 'ok', browser_connected: false, writes_enabled: false } };
            if (name === 'pdd_search') { state.sources.add('123'); return { content: [{ type: 'text', text: 'search fixture' }], structuredContent: { status: 'ok', results: [{ goods_id: '123' }] } }; }
            if (name === 'pdd_read_item') {
              if (!state.sources.has('123')) return { content: [{ type: 'text', text: 'source missing' }], structuredContent: { status: 'unsupported', diagnostic: 'search_context_missing' }, isError: true };
              return fixture;
            }
            return { content: [{ type: 'text', text: 'business fixture' }], structuredContent: { status: 'unsupported' }, isError: true };
          }
          const response = await require('../../server.cjs').handle({ jsonrpc: '2.0', id: 1, ...request });
          if (response.error) throw new McpError(response.error.code, response.error.message);
          return response.result;
        })();
        state.pending.add(actual);
        actual.finally(() => state.pending.delete(actual)).catch(() => {});
        if (!options.simulateTimeout) return actual;
        let timer;
        return Promise.race([actual, new Promise((_, reject) => { timer = setTimeout(() => reject(new McpError(ErrorCode.RequestTimeout, 'fixture timeout')), settings.timeout); })]).finally(() => clearTimeout(timer));
      },
    };
  };
}
async function start(t, options = {}) {
  const tracker = {}, config = { host: '127.0.0.1', port: 0, token: TOKEN, requestTimeout: 1000, idleTimeout: 1800000, ...options.config };
  const gateway = await createGateway({ config, backendFactory: options.backendFactory || (options.real ? undefined : fakeFactory(tracker, options.fake)), env: options.env || process.env, now: options.now, log: entry => (tracker.events ||= []).push(entry) });
  const binding = await gateway.listen();
  t.after(async () => gateway.close());
  return { gateway, tracker, config, ...binding };
}
async function connect(t, url, token = TOKEN) {
  const client = new Client({ name: 'http-acceptance', version: '1' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } }, reconnectionOptions: { maxRetries: 0 } });
  await client.connect(transport);
  t.after(async () => { await transport.terminateSession().catch(() => {}); await client.close(); });
  return { client, transport };
}
async function rpc(url, session, id, method, params, extra = {}) {
  return fetch(url, { method: 'POST', headers: { ...headers, 'Mcp-Session-Id': session, 'MCP-Protocol-Version': '2025-03-26', ...extra }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
}
module.exports = { TOKEN, headers, start, connect, rpc, delay, fakeFactory };
