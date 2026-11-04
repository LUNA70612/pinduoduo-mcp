'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function projectRoot() {
  let dir = __dirname;
  for (;;) {
    try { if (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'pinduoduo-mcp') return dir; } catch {}
    const parent = path.dirname(dir);
    if (dir === parent) throw Error('无法确定项目工作目录，请从项目内启动。');
    dir = parent;
  }
}
const ROOT = projectRoot();
function failure(code, message) { return Object.assign(new Error(message), { code }); }
function goodsId(value) {
  if (typeof value !== 'string') throw failure('INVALID_ARGUMENT', 'goods_id 必须是数字字符串或商品链接。');
  const s = value.trim();
  if (/^[1-9]\d{0,29}$/.test(s)) return s;
  let u;
  try { u = new URL(s); } catch { throw failure('INVALID_ARGUMENT', '无法解析商品 goods_id。'); }
  if (u.protocol !== 'https:' || u.hostname !== 'mobile.yangkeduo.com' || u.port || u.username || u.password || u.searchParams.getAll('goods_id').length !== 1 || !/^[1-9]\d{0,29}$/.test(u.searchParams.get('goods_id') || '')) throw failure('INVALID_ARGUMENT', '只接受 HTTPS mobile.yangkeduo.com 商品链接。');
  return u.searchParams.get('goods_id');
}
function integer(value, dflt, min, max, label) {
  if (value === undefined) return dflt;
  if (!Number.isInteger(value) || value < min || value > max) throw failure('INVALID_ARGUMENT', `${label} 必须是 ${min}–${max} 的整数。`);
  return value;
}
function normalize(kind, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('INVALID_ARGUMENT', '参数必须是对象。');
  const a = { ...input };
  if (['detail', 'read_sku', 'add_cart', 'contact_seller'].includes(kind)) a.goods_id = goodsId(a.goods_id ?? a.target);
  if(kind==='detail'&&a.include_product_images!==undefined&&typeof a.include_product_images!=='boolean')throw failure('INVALID_ARGUMENT','include_product_images 必须是布尔值。');
  if(kind==='detail'&&a.entry!==undefined&&!['auto','search'].includes(a.entry))throw failure('INVALID_ARGUMENT','entry 只能为 auto 或 search。');
  if (['detail','read_sku'].includes(kind) && a.budget_max !== undefined && (typeof a.budget_max !== 'number' || require('./_comparison.cjs').cents(a.budget_max) === null)) throw failure('INVALID_ARGUMENT','budget_max 必须是非负金额，最多两位小数。');
  if (kind === 'search') {
    if (typeof a.query !== 'string' || !a.query.trim() || a.query.trim().length > 100) throw failure('INVALID_ARGUMENT', 'query 必须是 1–100 字符的关键词。');
    a.query = a.query.trim(); a.limit = integer(a.limit, 10, 1, 10, 'limit');
    if (a.sort !== undefined && !['default', 'sales', 'price'].includes(a.sort)) throw failure('INVALID_ARGUMENT', 'sort 不受支持。');
    const {cents}=require('./_comparison.cjs');
    for (const key of ['price_min','price_max']) if (a[key] !== undefined && (typeof a[key] !== 'number' || cents(a[key]) === null)) throw failure('INVALID_ARGUMENT', `${key} 必须是非负金额，最多两位小数。`);
    if (a.price_min !== undefined && a.price_max !== undefined && a.price_min > a.price_max) throw failure('INVALID_ARGUMENT','价格下限不能大于上限。');
    if (a.exclude_group_purchase !== undefined && typeof a.exclude_group_purchase !== 'boolean') throw failure('INVALID_ARGUMENT','exclude_group_purchase 必须是布尔值。');
    for (const key of ['include_terms','exclude_terms']) if (a[key] !== undefined) {
      if (!Array.isArray(a[key]) || a[key].length > 10 || a[key].some(v => typeof v !== 'string' || !v.trim() || v.length > 50)) throw failure('INVALID_ARGUMENT', `${key} 必须是最多 10 个非空词的数组，每词最多 50 字符。`);
      a[key]=[...new Set(a[key].map(v=>v.trim()))];
    }
  }
  if (kind === 'browse_home') a.limit = integer(a.limit, 20, 1, 60, 'limit');
  if (['read_cart', 'browse_home'].includes(kind) && a.cursor !== undefined && a.cursor !== '') throw failure('UNSUPPORTED', '不支持跨调用 cursor 翻页。');
  if (['read_sku', 'add_cart'].includes(kind) && a.spec_selection !== undefined) {
    if (!a.spec_selection || typeof a.spec_selection !== 'object' || Array.isArray(a.spec_selection) || !Object.keys(a.spec_selection).length || Object.entries(a.spec_selection).some(([k,v]) => !k.trim() || typeof v !== 'string' || !v.trim() || k.length > 100 || v.length > 100) || Object.keys(a.spec_selection).length > 10) throw failure('INVALID_ARGUMENT', 'spec_selection 必须是非空规格名称到规格值的映射。');
  }
  if (kind === 'add_cart') {
    a.quantity = integer(a.quantity, 1, 1, 99, 'quantity');
    if (a.sku_index !== undefined) a.sku_index = integer(a.sku_index, 0, 0, 9999, 'sku_index');
    if (a.spec_selection !== undefined) {
      if (!a.spec_selection || typeof a.spec_selection !== 'object' || Array.isArray(a.spec_selection) || Object.entries(a.spec_selection).some(([k, v]) => !k.trim() || typeof v !== 'string' || !v.trim() || k.length > 100 || v.length > 100) || Object.keys(a.spec_selection).length > 10) throw failure('INVALID_ARGUMENT', 'spec_selection 必须是规格名称到规格值的映射。');
    }
  }
  if (kind === 'contact_seller') {
    if (a.mode === undefined) a.mode = 'read';
    if (!['read', 'send'].includes(a.mode)) throw failure('INVALID_ARGUMENT', 'mode 只能为 read 或 send。');
    if (a.mode === 'send') {
      if (typeof a.message !== 'string' || !a.message.trim() || a.message.length > 2000) throw failure('INVALID_ARGUMENT', '发送消息长度必须为 1–2000 字符。');
      if (typeof a.shop_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(a.shop_id)) throw failure('INVALID_ARGUMENT', '发送前必须指定已核对的 shop_id。');
    }
  }
  if (a.confirm !== undefined && typeof a.confirm !== 'boolean') throw failure('INVALID_ARGUMENT', 'confirm 必须是布尔值。');
  if (a.request_id !== undefined && (typeof a.request_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(a.request_id))) throw failure('INVALID_ARGUMENT', 'request_id 需要 8–128 位字母数字、点、横线或下划线。');
  return a;
}
function isWrite(kind, args) { return kind === 'add_cart' || (kind === 'contact_seller' && args.mode === 'send'); }
function writePermission(action, env = process.env, stateDir = path.join(ROOT, 'state')) {
  if (env.PDD_ENABLE_WRITES !== '1') return false;
  if (env.PDD_WRITE_TEST_MODE === '1') return true;
  try {
    const a = JSON.parse(fs.readFileSync(path.join(stateDir, 'acceptance.local.json'), 'utf8'))[action];
    return !!(a && a.status === 'passed' && typeof a.evidence === 'string' && a.evidence.trim());
  } catch { return false; }
}
function writePreflight(kind, args, permission = writePermission) {
  if (!isWrite(kind, args)) return null;
  if (args.confirm !== true) return { status: 'awaiting_confirmation', action: kind, goods_id: args.goods_id };
  const action = kind === 'contact_seller' ? 'contact_seller_send' : kind;
  if (!permission(action)) return { status: 'disabled', action: kind, goods_id: args.goods_id, message: '写能力未通过本地验收闸门。' };
  if (!args.request_id) throw failure('INVALID_ARGUMENT', '写操作必须提供唯一 request_id。');
  return null;
}
function readJSON(file, dflt) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return dflt; throw failure('STATE_CORRUPT', '运行状态损坏，请先检查状态文件。'); }
}
function saveJSON(file, value) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function createRuntime({ stateDir = path.join(ROOT, 'state'), interval = 90000, enabled = action => writePermission(action, process.env, stateDir) } = {}) {
  const lock = path.join(stateDir, 'browser.lock');
  const stateFile = path.join(stateDir, 'browser-state.json');
  let queue = Promise.resolve();
  async function acquire() {
    fs.mkdirSync(stateDir, { recursive: true });
    const deadline = Date.now() + 120000;
    for (;;) {
      try { fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid })); return; }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        const ownerFile = path.join(lock, 'owner.json');
        const owner = readJSON(ownerFile, null);
        if (owner && Number.isInteger(owner.pid)) {
          try { process.kill(owner.pid, 0); }
          catch (alive) {
            if (alive.code === 'ESRCH') throw failure('STALE_LOCK', '上次进程异常退出，浏览器锁仍保留。确认无操作后运行 npm run unlock。');
          }
        }
        if (Date.now() >= deadline) throw failure('BROWSER_BUSY', '浏览器正在被其他请求使用。');
        await sleep(100);
      }
    }
  }
  async function execute(kind, input, operation) {
    const args = normalize(kind, input);
    const preflight = writePreflight(kind, args, enabled);
    if (preflight) return preflight;
    await acquire();
    let receipt;
    let action;
    try {
      if (isWrite(kind, args)) {
        action = kind === 'contact_seller' ? 'contact_seller_send' : kind;
        const folder = path.join(stateDir, 'requests'); fs.mkdirSync(folder, { recursive: true });
        receipt = path.join(folder, `${crypto.createHash('sha256').update(args.request_id).digest('hex')}.json`);
        const record = { request_id: args.request_id, action, fingerprint: crypto.createHash('sha256').update(JSON.stringify(args)).digest('hex'), status: 'started', started_at: new Date().toISOString() };
        try { fs.writeFileSync(receipt, JSON.stringify(record), { flag: 'wx', mode: 0o600 }); }
        catch (e) { if (e.code === 'EEXIST') { receipt = undefined; throw failure('DUPLICATE_REQUEST', 'request_id 已执行或结果未知；拒绝再次执行。'); } throw e; }
      }
      const state = readJSON(stateFile, { available_at: 0 });
      while (state.available_at > Date.now()) await sleep(Math.min(1000, state.available_at - Date.now()));
      saveJSON(stateFile, { available_at: Date.now() + interval });
      let result;
      try { result = await operation(args); }
      catch (e) {
        if (['AUTH_REQUIRED', 'VERIFICATION_REQUIRED'].includes(e.code)) saveJSON(stateFile, { available_at: Date.now() + Math.max(90000, interval) });
        if (!receipt) throw e;
        result = { status: 'result_unknown', code: e.code || 'OPERATION_FAILED', message: '写操作未获得可确认结果，请人工核对；相同请求不会重试。' };
      }
      if (receipt) {
        const previous = readJSON(receipt, {});
        saveJSON(receipt, { ...previous, status: result?.status || 'result_unknown', finished_at: new Date().toISOString() });
        return { ...result, request_id: args.request_id };
      }
      return result;
    } finally {
      try { fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock); } catch {}
    }
  }
  return {
    run(kind, args, operation) {
      const task = queue.then(() => execute(kind, args, operation));
      queue = task.catch(() => undefined); return task;
    },
    state() { const s = readJSON(stateFile, { available_at: 0 }); return { cooldown_ms: Math.max(0, s.available_at - Date.now()), locked: fs.existsSync(lock) }; },
  };
}
const runtime = createRuntime();
module.exports = { ROOT, failure, goodsId, normalize, writePermission, writePreflight, isWrite, createRuntime, runtime };
