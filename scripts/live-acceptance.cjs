'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createStdioClient } = require('../tools/stdio-client.cjs');
const { browserConfig, ROOT } = require('../tools/config.cjs');
const only = process.argv.slice(2);
const goods = '960369474830';
const cases = [
  { id: 'status', tool: 'pdd_status', args: {}, expected: ['ok'] },
  { id: 'resume', tool: 'pdd_resume', args: {}, expected: ['session_ok'] },
  { id: 'foreign-domain', tool: 'pdd_read_item', args: { url: 'https://invalid.example/goods.html?goods_id=123' }, rpcError: -32602 },
  { id: 'cursor', tool: 'pdd_read_cart', args: { cursor: 'unsupported-next-page' }, expected: ['unsupported'] },
  { id: 'search', tool: 'pdd_search', args: { query: '100元耳机', limit: 3 }, expected: ['ok'] },
  { id: 'search-empty-probe', tool: 'pdd_search', args: { query: '不存在的商品qzv7831049652', limit: 1 }, expected: ['empty'] },
  { id: 'detail', tool: 'pdd_read_item', args: { url: `https://mobile.yangkeduo.com/goods.html?goods_id=${goods}` }, expected: ['ok'] },
  { id: 'home', tool: 'pdd_browse_home', args: { limit: 3 }, expected: ['ok', 'empty'] },
  { id: 'sku', tool: 'pdd_read_sku', args: { goods_id: goods }, expected: ['ok'] },
  { id: 'cart', tool: 'pdd_read_cart', args: {}, expected: ['ok', 'empty'] },
  { id: 'chat-read', tool: 'pdd_contact_seller', args: { goods_id: goods, mode: 'read' }, expected: ['ok'] },
  { id: 'login', tool: 'pdd_login', args: {}, expected: ['login_page_opened'] },
];
// Whitelist fields, never persist raw cart items, nickname, chat bubbles, cookie or tokens.
function redact(data) {
  if (!data) return {};
  const fields = ['status', 'code', 'count', 'truncated', 'logged_in', 'browser_connected', 'runtime', 'writes_enabled', 'variant_price_verified', 'price_basis'];
  const result = Object.fromEntries(fields.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
  if (Array.isArray(data.results)) result.products = data.results.map(item => ({ goods_id: item.goods_id, title: item.title, price: item.price, url: item.url }));
  if (Array.isArray(data.skus)) result.sku_count = data.skus.length;
  if (Array.isArray(data.spec_groups)) result.spec_group_count = data.spec_groups.length;
  if (Array.isArray(data.items)) result.cart_item_count = data.items.length;
  if (Array.isArray(data.messages)) result.message_count = data.messages.length;
  for (const key of ['goods_id', 'title', 'price', 'coupon_offer']) if (data[key]) result[key] = data[key];
  return result;
}
async function main() {
  for (const id of only) if (!cases.some(item => item.id === id)) throw Error(`未知只读验收项：${id}`);
  const config = browserConfig();
  const browser = await (await fetch(`${config.endpoint}/json/version`, { signal: AbortSignal.timeout(3000) })).json();
  const directory = path.join(ROOT, 'docs', 'dev', 'acceptance', new Date().toISOString().replaceAll(/[:.]/g, '-'));
  fs.mkdirSync(directory, { recursive: true });
  const client = createStdioClient({ env: { ...process.env, OPENCLI_CDP_ENDPOINT: config.endpoint, PDD_ENABLE_WRITES: '0', PDD_WRITE_TEST_MODE: '0' } });
  const records = [];
  try {
    const initialized = await client.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'pdd-readonly-acceptance', version: '1' } });
    client.notify('notifications/initialized');
    const discovered = await client.request('tools/list');
    if (discovered.result.tools.length !== 10) throw Error('MCP 未发现 10 个工具。');
    for (const item of cases.filter(item => !only.length || only.includes(item.id))) {
      const started = new Date().toISOString();
      let response;
      try { response = await client.request('tools/call', { name: item.tool, arguments: item.args }); }
      catch { response = { error: { code: 'CLIENT_TIMEOUT' } }; }
      const data = response.result?.structuredContent;
      const passed = item.rpcError ? response.error?.code === item.rpcError : item.expected.includes(data?.status) && (item.id === 'cursor' ? response.result.isError : !response.result.isError);
      const record = { started_at: started, finished_at: new Date().toISOString(), transport: 'stdio JSON-RPC', browser: browser.Browser, cdp_endpoint: config.endpoint, tool_count: discovered.result.tools.length, server: initialized.result.serverInfo, case: item.id, tool: item.tool, input_summary: item.args, expected_status: item.expected || null, expected_rpc_error: item.rpcError || null, actual: redact(data), rpc_error: response.error?.code || null, passed, manual_page_crosscheck: 'pending', business_accepted: false, limitation: passed ? '人工页面逐字段核对及其他账号/机器尚未完成。' : '未获得预期业务数据；不以 unsupported 或模拟页替代通过证据。' };
      records.push(record);
      fs.writeFileSync(path.join(directory, `${item.id}.json`), JSON.stringify(record, null, 2) + '\n');
      fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify({ date: new Date().toISOString(), evidence_directory: path.relative(ROOT, directory), cases: records.map(r => ({ case: r.case, passed: r.passed, status: r.actual.status || r.rpc_error })), business_accepted: false }, null, 2) + '\n');
      console.log(JSON.stringify({ evidence: path.relative(ROOT, directory), case: item.id, status: data?.status || response.error?.code, passed }));
      if (['verification_required', 'auth_required'].includes(data?.status)) { console.log('需要人工处理会话；停止后续页面操作。'); break; }
    }
  } finally { client.close(); }
}
if (require.main === module) require('../tools/acceptance-lock.cjs').withAcceptance(ROOT,main).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { redact };
