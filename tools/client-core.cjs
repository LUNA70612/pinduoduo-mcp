'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { ROOT, normalize, writePreflight, runtime, failure } = require('../clis/pdd/_shared.cjs');
const wire = require('./opencli-wire.cjs');
const runFile = promisify(execFile);
const PROFILE = 'pinduoduo-project';
function childEnv(source = process.env) {
  const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|OPENCLI_CDP_ENDPOINT|OPENCLI_CDP_TARGET|PDD_ENABLE_WRITES|PDD_WRITE_TEST_MODE)$/i;
  const result = Object.fromEntries(Object.entries(source).filter(([key]) => allowed.test(key)));
  const home = path.join(ROOT, 'runtime', 'home');
  const temp = path.join(ROOT, 'runtime', 'temp');
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(temp, { recursive: true });
  const config = require('./config.cjs').browserConfig(source);
  return { ...result, USERPROFILE: home, HOME: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), TEMP: temp, TMP: temp, OPENCLI_CDP_ENDPOINT: config.endpoint, ...(config.target ? { OPENCLI_CDP_TARGET: config.target } : {}), OPENCLI_BROWSER_COMMAND_TIMEOUT: '180', PDD_PROJECT_ROOT: ROOT };
}
async function connected() {
  try {
    const u = new URL(require('./config.cjs').browserConfig().endpoint);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const r = await fetch(new URL('/json/version', u), { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return false;
    const v = await r.json(); return typeof v.webSocketDebuggerUrl === 'string' && /^(ws|wss):/.test(v.webSocketDebuggerUrl);
  } catch { return false; }
}
async function cli(args, context = {}, timeout = 210000) {
  if(typeof context==='number'){timeout=context;context={};}
  const env = await require('./target-selection.cjs').operationEnv(args[0], { goods_id: args[1], query: args[1],target_id:context.target_id }, childEnv());
  env.PDD_INTERNAL_LINKS='1';
  if(context.source_url)env.PDD_SOURCE_URL=context.source_url;
  if(context.source_search_url)env.PDD_SOURCE_SEARCH_URL=context.source_search_url;
  if(Number.isFinite(context.document_id))env.PDD_SOURCE_DOCUMENT_ID=String(context.document_id);
  if(context.entry==='search')env.PDD_PRODUCT_ENTRY='search';
  return runFile(process.execPath, [require('./opencli-runtime.cjs').entry(), 'pdd', ...args, '-f', 'json'], { cwd: ROOT, env, shell: false, windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' });
}
function decodeFailure(error, write) {
  if (error.stdout) {
    try { return wire.parse(error.stdout); }
    catch (parsed) {
      if (write && parsed.code === 'INVALID_OUTPUT') return { status: 'result_unknown', code: 'INVALID_OUTPUT', message: '写操作失败且响应不可解析，请人工核对；不会自动重试。' };
      if (parsed.code) throw parsed;
    }
  }
  if (error.killed || /timeout|timed out|ETIMEDOUT|cdp_timeout|outcome_unknown/i.test([error.code, error.message].join(' '))) {
    if (write) return { status: 'result_unknown', code: 'TIMEOUT', message: '写操作超时，请人工核对；不会自动重试。' };
    throw failure('TIMEOUT', '浏览器操作超时，请检查浏览器页面。');
  }
  throw failure(error.code || 'OPENCLI_FAILED', '本地 OpenCLI 执行失败，请检查安装与连接。');
}
function createClient({ invoke = cli, now = Date.now } = {}) {
  const sourceLinks=new Map();
  function recoverySource(tool, input = {}) {
    if (!['pdd_read_item', 'pdd_read_sku'].includes(tool)) return { status: 'ok' };
    const kind = tool === 'pdd_read_item' ? 'detail' : 'read_sku';
    const args = normalize(kind, { ...input, goods_id: kind === 'detail' ? input.url : input.goods_id });
    const source = sourceLinks.get(args.goods_id);
    if (source && source.expires <= now()) return { status: 'unsupported', code: 'SEARCH_CONTEXT_EXPIRED', diagnostic: 'search_context_expired', message: '搜索来源已超过 30 分钟，请显式重新搜索并核对新候选；不会自动重试。' };
    if (!source?.searchURL) return { status: 'unsupported', code: 'SEARCH_CONTEXT_MISSING', diagnostic: 'search_context_missing', message: '当前连接缺少搜索来源，请显式重新搜索并核对候选；不会直接打开商品链接。' };
    return { status: 'ok' };
  }
  function collectSources(data,searchURL) {
    const searchContext=data._search_context;
    delete data._search_context;
    for(const key of ['results','pending_verification']) for(const item of data[key]||[]) {
      if(Object.hasOwn(item,'_source_url')) {
        try { const u=new URL(item._source_url);if(u.origin==='https://mobile.yangkeduo.com'&&!u.username&&!u.password&&u.pathname==='/goods.html'&&u.searchParams.getAll('goods_id').length===1&&u.searchParams.get('goods_id')===item.goods_id)sourceLinks.set(item.goods_id,{url:u.href,searchURL,target_id:searchContext?.target_id,document_id:searchContext?.document_id,expires:now()+30*60*1000}); } catch {}
        delete item._source_url;
      }
    }
    while(sourceLinks.size>60)sourceLinks.delete(sourceLinks.keys().next().value);
  }
  async function execute(kind, input = {}) {
    const args = normalize(kind, input);
    const preflight = writePreflight(kind, args);
    if (preflight) return preflight;
    const flags = [kind];
    if (kind === 'search') flags.push(args.query);
    if (['detail', 'read_sku', 'add_cart', 'contact_seller'].includes(kind)) flags.push(args.goods_id);
    for (const key of ['limit', 'sort', 'cursor', 'sku_index', 'spec_selection', 'quantity', 'mode', 'message', 'confirm', 'request_id', 'shop_id','price_min','price_max','include_terms','exclude_terms','exclude_group_purchase','include_product_images','budget_max']) {
      if (args[key] !== undefined && args[key] !== '') flags.push(`--${key}`, typeof args[key] === 'object' ? JSON.stringify(args[key]) : String(args[key]));
    }
    let data;
    let raw;
    const write = kind === 'add_cart' || args.mode === 'send';
    const source=sourceLinks.get(args.goods_id);
    if(['detail','read_sku'].includes(kind)&&source&&source.expires<=now())return{status:'unsupported',code:'SEARCH_CONTEXT_EXPIRED',diagnostic:'search_context_expired',message:'搜索来源已超过 30 分钟，请显式重新搜索并核对新候选；不会自动重试。'};
    const context=source&&source.expires>now()?{source_url:source.url,source_search_url:source.searchURL,target_id:source.target_id,document_id:source.document_id,entry:args.entry}:{entry:args.entry};
    if(['detail','read_sku'].includes(kind)&&!context.source_search_url)return{status:'unsupported',code:'SEARCH_CONTEXT_MISSING',diagnostic:'search_context_missing',message:'请先在同一 MCP 连接中常规搜索该商品；详情与规格只能通过正常搜索卡片点击进入。'};
    try { raw = await invoke(flags,context); }
    catch (e) { data = decodeFailure(e, write); }
    if (raw) {
      try { data = wire.parse(raw.stdout); }
      catch (e) {
        if (!write || (e.code && e.code !== 'INVALID_OUTPUT')) throw e;
        data = { status: 'result_unknown', code: 'INVALID_OUTPUT', request_id: args.request_id, message: '写操作响应无法解析，请人工核对；不会重试。' };
      }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      if (!write) throw failure('INVALID_OUTPUT', '适配器返回结构不匹配。');
      data = { status: 'result_unknown', code: 'INVALID_OUTPUT', request_id: args.request_id };
    }
    const searchURL=kind==='search'?`https://mobile.yangkeduo.com/search_result.html?search_key=${encodeURIComponent(args.query)}${args.sort&&args.sort!=='default'?`&sort=${args.sort}`:''}`:undefined;
    collectSources(data,searchURL);
    return { source: 'pinduoduo via local OpenCLI', fetched_at: new Date().toISOString(), ...data };
  }
  return {
    recoverySource,
    search: input => execute('search', input),
    readItem: input => execute('detail', { ...input, goods_id: input?.url }),
    browseHome: input => execute('browse_home', input),
    readCart: input => execute('read_cart', input),
    readSku: input => execute('read_sku', input),
    addCart: input => execute('add_cart', input),
    contactSeller: input => execute('contact_seller', input),
    login: () => execute('auth'), resume: () => execute('resume'),
  };
}
function validateSchema(schema, value, label = 'arguments') {
  const type = schema.type;
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('INVALID_ARGUMENT', `${label} 必须是对象。`);
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw failure('INVALID_ARGUMENT', `${label}.${key} 必填。`);
    for (const [key, v] of Object.entries(value)) {
      if (schema.properties && Object.hasOwn(schema.properties, key)) validateSchema(schema.properties[key], v, `${label}.${key}`);
      else if (schema.additionalProperties === false) throw failure('INVALID_ARGUMENT', `${label}.${key} 不受支持。`);
      else if (typeof schema.additionalProperties === 'object') validateSchema(schema.additionalProperties, v, `${label}.${key}`);
    }
  } else if (type === 'integer') {
    if (!Number.isInteger(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) throw failure('INVALID_ARGUMENT', `${label} 数值范围或类型错误。`);
  } else if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) throw failure('INVALID_ARGUMENT', `${label} 数值范围或类型错误。`);
  } else if (type === 'array') {
    if (!Array.isArray(value) || value.length > (schema.maxItems ?? Infinity) || value.length < (schema.minItems ?? 0)) throw failure('INVALID_ARGUMENT', `${label} 数组长度或类型错误。`);
    value.forEach((item,i) => validateSchema(schema.items,item,`${label}[${i}]`));
  } else if (type === 'string') {
    if (typeof value !== 'string' || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) throw failure('INVALID_ARGUMENT', `${label} 字符串格式错误。`);
  } else if (type === 'boolean' && typeof value !== 'boolean') throw failure('INVALID_ARGUMENT', `${label} 必须是布尔值。`);
  if (schema.enum && !schema.enum.includes(value)) throw failure('INVALID_ARGUMENT', `${label} 枚举值无效。`);
}
async function launchChrome() {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'start-browser.cjs')], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', c => c === 0 ? resolve() : reject(Error('浏览器启动失败。'))); });
}
const client = createClient();
module.exports = { ...client, createClient, cli, childEnv, connected, launchChrome, PROFILE, runtime, validateSchema };
