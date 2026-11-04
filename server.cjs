'use strict';
const readline = require('node:readline');
const pdd = require('./tools/pdd.cjs');
const tools = pdd.tools;
const { createOperations, errorData } = require('./tools/operations.cjs');
const operations = createOperations({ executionIdle: () => !pdd.runtime.state().locked });
const shopping = require('./tools/shopping-prompts.cjs');
const { normalize } = require('./clis/pdd/_shared.cjs');
const errorResponse = (id, code, message) => ({ jsonrpc: '2.0', id: typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id)) ? id : null, error: { code, message } });
const methods = { pdd_search: 'search', pdd_read_item: 'readItem', pdd_browse_home: 'browseHome', pdd_read_cart: 'readCart', pdd_read_sku: 'readSku', pdd_add_cart: 'addCart', pdd_contact_seller: 'contactSeller', pdd_login: 'login', pdd_resume: 'resume' };
async function handle(m, operationStore = operations) {
  if (!m || Array.isArray(m) || m.jsonrpc !== '2.0' || typeof m.method !== 'string' || (Object.hasOwn(m, 'id') && !(m.id === null || typeof m.id === 'string' || (typeof m.id === 'number' && Number.isFinite(m.id))))) return errorResponse(m?.id, -32600, 'Invalid Request');
  if (!Object.hasOwn(m, 'id')) return undefined;
  if (m.params !== undefined && (!m.params || typeof m.params !== 'object' || Array.isArray(m.params))) return errorResponse(m.id, -32602, 'params 必须是对象。');
  let result;
  if (m.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: true }, prompts: {} }, serverInfo: { name: 'pinduoduo-mcp', version: require('./package.json').version }, instructions:shopping.instructions };
  else if (m.method === 'ping') result = {};
  else if (m.method === 'tools/list') result = { tools };
  else if (m.method === 'prompts/list') result = { prompts: shopping.prompts };
  else if (m.method === 'prompts/get') {
    try { result = shopping.getPrompt(m.params); }
    catch(error) { return errorResponse(m.id,-32602,error.message); }
  }
  else if (m.method === 'resources/list') result = { resources: [] };
  else if (m.method === 'resources/templates/list') result = { resourceTemplates: [] };
  else if (m.method === 'tools/call') {
    const tool = tools.find(t => t.name === m.params?.name);
    if (!tool) return errorResponse(m.id, -32602, '未知工具。');
    const args = m.params.arguments === undefined ? {} : m.params.arguments;
    try {
      pdd.validateSchema(tool.inputSchema, args);
      if (methods[tool.name] && tool.name !== 'pdd_resume') {
        const kinds = { pdd_read_item: 'detail', pdd_browse_home: 'browse_home', pdd_read_cart: 'read_cart', pdd_read_sku: 'read_sku', pdd_add_cart: 'add_cart', pdd_contact_seller: 'contact_seller', pdd_login: 'auth', pdd_search: 'search' };
        normalize(kinds[tool.name], tool.name === 'pdd_read_item' ? { ...args, goods_id: args.url } : args);
      }
    }
    catch (e) {
      if (e.code === 'UNSUPPORTED') { const data = errorData(e); return { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: true } }; }
      return errorResponse(m.id, -32602, e.message);
    }
    try {
      const dispatch = (name, input) => {
        const definition = tools.find(t => t.name === name);
        pdd.validateSchema(definition.inputSchema, input);
        return pdd[methods[name]](input);
      };
      const data = tool.name === 'pdd_status' ? { status: 'ok', browser_connected: await pdd.connected(), cooldown: pdd.runtime.state(), runtime: '@jackwener/opencli 2.0.2', profile: pdd.PROFILE, operations: await operationStore.summaryAsync(), writes_enabled: require('./clis/pdd/_shared.cjs').writePermission('add_cart'), user_login_required: true, login_status: 'not_checked', login_policy: 'manual' }
        : tool.name === 'pdd_resume' ? await operationStore.resume(args, () => pdd.resume(), dispatch, pdd.recoverySource)
        : await operationStore.run(tool.name, args, () => dispatch(tool.name, args));
      if (!data || typeof data.status !== 'string') throw Object.assign(Error('适配器响应缺少 status。'), { code: 'INVALID_OUTPUT' });
      const images=tool.name==='pdd_read_item'&&args.include_product_images===true?await require('./tools/product-images.cjs').imageContent(data):[];
      result = { content: [{ type: 'text', text: JSON.stringify(data) },...images], structuredContent: data, isError: !['ok', 'empty', 'session_ok', 'login_page_opened', 'awaiting_confirmation', 'add_cart_confirmed', 'sent_confirmed', 'already_finished'].includes(data.status) };
    } catch (e) {
      if (e.code === 'INVALID_ARGUMENT') return errorResponse(m.id, -32602, e.message);
      const data = errorData(e);
      result = { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: true };
    }
  } else return errorResponse(m.id, -32601, 'Method not found');
  return { jsonrpc: '2.0', id: m.id, result };
}
function serve() {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', async line => {
    let message;
    try { message = JSON.parse(line); }
    catch { process.stdout.write(JSON.stringify(errorResponse(null, -32700, 'Parse error')) + '\n'); return; }
    try { const r = await handle(message); if (r) process.stdout.write(JSON.stringify(r) + '\n'); }
    catch { process.stdout.write(JSON.stringify(errorResponse(message?.id, -32603, 'Internal error')) + '\n'); }
  });
}
if (require.main === module) serve();
module.exports = { tools, handle, serve };
