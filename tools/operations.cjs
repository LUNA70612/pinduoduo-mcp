'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ROOT, failure } = require('../clis/pdd/_shared.cjs');
const readTools = new Set(['pdd_search', 'pdd_read_item', 'pdd_browse_home', 'pdd_read_cart', 'pdd_read_sku', 'pdd_contact_seller']);
const recoverable = new Set(['auth_required', 'verification_required', 'timeout', 'page_loading', 'service_unavailable', 'browser_disconnected', 'browser_target_missing', 'browser_busy', 'interrupted']);
const active = new Set();
const CURRENT_TTL_MS = 30 * 60 * 1000;
function processState(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return 'unknown';
  try { process.kill(pid, 0); return 'alive'; }
  catch (error) { return error.code === 'ESRCH' ? 'dead' : 'unknown'; }
}
function errorData(error) {
  const code = typeof error.code === 'string' ? error.code : 'OPERATION_FAILED';
  const statuses = { AUTH_REQUIRED: 'auth_required', VERIFICATION_REQUIRED: 'verification_required', TIMEOUT: 'timeout', PAGE_LOADING: 'page_loading', INVALID_OUTPUT: 'parse_failed', PARSE_ERROR: 'parse_failed', UNSUPPORTED: 'unsupported', BROWSER_BUSY: 'browser_busy', STALE_LOCK: 'interrupted', STATE_CORRUPT: 'state_corrupt', DUPLICATE_REQUEST: 'duplicate_request' };
  const extra = { BROWSER_DISCONNECTED:'browser_disconnected', BROWSER_TARGET_MISSING:'browser_target_missing', SERVICE_UNAVAILABLE:'service_unavailable' };
  return { status: statuses[code] || extra[code] || 'operation_failed', code, message: error.message || '操作未完成。' };
}
function createOperations({ dir = path.join(ROOT, 'state', 'operations'), now = Date.now, processState: ownerState = processState, executionIdle = () => true } = {}) {
  const file = id => {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw failure('INVALID_ARGUMENT', 'resume_id 无效。');
    return path.join(dir, `${id}.json`);
  };
  function save(record) {
    fs.mkdirSync(dir, { recursive: true });
    const target = file(record.resume_id), temp = `${target}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(record), { mode: 0o600 });
    fs.renameSync(temp, target);
  }
  function read(id) {
    try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw failure('INVALID_ARGUMENT', '找不到该恢复记录。'); throw error; }
  }
  const allowed = (tool, args) => readTools.has(tool) && (tool !== 'pdd_contact_seller' || (args.mode || 'read') === 'read');
  const timestamp = record => Date.parse(record.finished_at || record.started_at || '');
  const fresh = time => Number.isFinite(time) && time <= now() && now() - time < CURRENT_TTL_MS;
  function pageProof(data) {
    const e = data.page_evidence;
    const kind = { auth_required: 'login_wall', verification_required: 'verification' }[data.status || data.outcome];
    return !!(kind && e?.kind === kind && ['visible_page', 'login_url'].includes(e.source) && fresh(Date.parse(e.observed_at)));
  }
  function classify(record) {
    if (record.status === 'running') {
      const kind = active.has(record.resume_id) ? 'running' : ownerState(record.pid) === 'dead' ? 'interrupted' : 'execution_unknown';
      return { kind, current: kind === 'running' || fresh(timestamp(record)) };
    }
    if (record.status === 'finished') return { kind: 'finished', current: false };
    const outcome = record.outcome;
    // Legacy auth flags lack page evidence; never turn them into current human tasks.
    if (record.status === 'waiting_for_user' && !pageProof({ ...record, status: outcome }) && ['auth_required', 'verification_required'].includes(outcome)) return { kind: 'waiting', current: false };
    if (record.status === 'waiting_for_user' && pageProof({ ...record, status: outcome })) return { kind: 'waiting', current: fresh(timestamp(record)) };
    if (recoverable.has(outcome) && ['waiting_for_user', 'recoverable_failure'].includes(record.status)) return { kind: 'recoverable', current: fresh(timestamp(record)) };
    return { kind: 'finished', current: false };
  }
  async function run(tool, args, invoke) {
    if (!allowed(tool, args)) return invoke();
    const record = { format_version: 2, resume_id: randomUUID(), tool, args: { ...args }, status: 'running', pid: process.pid, started_at: new Date(now()).toISOString() };
    delete record.args.message; delete record.args.confirm; delete record.args.request_id;
    save(record);
    active.add(record.resume_id);
    try {
      let data;
      try { data = await invoke(); } catch (error) { data = { ...errorData(error), ...(error.code === 'TIMEOUT' ? { execution_ended: false } : {}) }; }
      if (!data || typeof data.status !== 'string') data = { status: 'parse_failed', code: 'INVALID_OUTPUT', message: '适配器响应缺少 status。' };
      const needsUser = pageProof(data), canRecover = recoverable.has(data.status);
      const ended = data.execution_ended !== false && !(data.status === 'timeout' && data.execution_ended !== true);
      const evidence = needsUser ? { kind: data.page_evidence.kind, source: data.page_evidence.source, observed_at: data.page_evidence.observed_at } : undefined;
      save({ ...record, status: needsUser ? 'waiting_for_user' : canRecover ? 'recoverable_failure' : 'finished', outcome: data.status, page_evidence: evidence, execution_ended: ended, finished_at: new Date(now()).toISOString() });
      return canRecover ? { ...data, resume_id: record.resume_id, waiting_for_user: needsUser, recoverable: true, execution_ended: ended, retry_allowed: ended,
        message: data.message || (needsUser ? '当前页面确认需要人工登录或验证；处理后先检查，仅显式 retry:true 才尝试恢复只读任务。' : '读取未完成；请检查连接或页面状态。不会自动重试，也不代表需要登录或验证码。') } : data;
    } finally { active.delete(record.resume_id); }
  }
  async function resume(args, check, dispatch, sourceCheck) {
    if (!args.resume_id) {
      if (args.retry) throw failure('INVALID_ARGUMENT', 'retry:true 需要 resume_id。');
      const session = await check();
      return { ...session, waiting_for_user: pageProof(session), retry_allowed: false, retried: false };
    }
    const record = read(args.resume_id);
    if (!allowed(record.tool, record.args || {})) throw failure('INVALID_ARGUMENT', '该恢复记录不是可恢复的只读任务。');
    const refuse = (status, diagnostic, message) => ({ status, diagnostic, message, resume_id: args.resume_id, retried: false, retry_allowed: false, waiting_for_user: false });
    const classification = classify(record);
    if (classification.kind === 'running') return refuse('browser_busy', 'original_execution_active', '原任务仍在执行，不重复执行。');
    if (record.status === 'finished') return refuse('already_finished', 'original_request_consumed', '原任务已经结束或已恢复过；请发起新的读取请求。');
    if (record.status === 'running') return refuse('execution_unknown', 'original_execution_unconfirmed', '进程信息不能证明原浏览器操作已结束；请先核对执行状态，不重放。');
    if (!fresh(timestamp(record))) return refuse('recovery_expired', 'recovery_record_expired', '恢复记录已过期或缺少有效时间；请显式发起新请求，商品读取须重新搜索。');
    if (record.execution_ended !== true) return refuse('execution_unknown', 'original_execution_unconfirmed', '无法确认原执行已结束，不重放。');
    const validateSource = () => {
      if (!['pdd_read_item', 'pdd_read_sku'].includes(record.tool)) return null;
      const source = sourceCheck?.(record.tool, record.args);
      if (source?.status === 'ok') return null;
      return { ...(source || { status: 'unsupported', diagnostic: 'search_context_unconfirmed', message: '无法确认同连接搜索来源，请显式重新搜索。' }), resume_id: args.resume_id, retried: false, retry_allowed: false, waiting_for_user: false };
    };
    const unavailable = validateSource(); if (unavailable) return unavailable;
    if (!executionIdle()) return refuse('browser_busy', 'browser_execution_not_idle', '浏览器运行锁尚未释放，不重复执行。');
    const session = await check();
    if (session.status === 'session_ok' && session.logged_in === true && record.status === 'waiting_for_user' && !fs.existsSync(`${file(args.resume_id)}.claim`)) {
      const latest = read(args.resume_id);
      if (latest.status === 'waiting_for_user') save({ ...latest, status: 'recoverable_failure', last_checked_at: new Date(now()).toISOString(), last_check: 'session_ok' });
    }
    if (session.status !== 'session_ok' || !session.logged_in || !args.retry) return { ...session, resume_id: args.resume_id, waiting_for_user: pageProof(session), retry_allowed: session.status === 'session_ok' && session.logged_in === true, retried: false };
    // Claim before dispatch so overlapping resume calls cannot replay twice.
    const claim = `${file(args.resume_id)}.claim`;
    try { fs.writeFileSync(claim, String(process.pid), { flag: 'wx' }); }
    catch (error) { if (error.code === 'EEXIST') return { status: 'browser_busy', resume_id: args.resume_id }; throw error; }
    try {
      if (read(args.resume_id).status === 'finished') return { status: 'already_finished', resume_id: args.resume_id };
      const lostSource = validateSource(); if (lostSource) return lostSource;
      if (!fresh(timestamp(record))) return refuse('recovery_expired', 'recovery_record_expired', '检查期间恢复记录已过期，请发起新请求。');
      if (!executionIdle()) return refuse('browser_busy', 'browser_execution_not_idle', '检查后浏览器仍忙，不重复执行。');
      // Consume before dispatch. A crash must never make the same original request replayable.
      save({ ...record, status: 'finished', outcome: 'retry_started', finished_at: new Date(now()).toISOString() });
      const data = await run(record.tool, record.args, () => dispatch(record.tool, record.args));
      save({ ...record, status: 'finished', outcome: 'retried', finished_at: new Date(now()).toISOString() });
      return { ...data, retried: true };
    } finally { fs.unlinkSync(claim); }
  }
  function emptyCounts() {
    const counts = { waiting: 0, running: 0, interrupted: 0, recoverable: 0, execution_unknown: 0,
      history: { total: 0, waiting: 0, recoverable: 0, running: 0, interrupted: 0, execution_unknown: 0, finished: 0 },
      invalid_records: 0, scope: { current_ttl_ms: CURRENT_TTL_MS, observed_at: new Date(now()).toISOString(), counts: 'current_valid_records', history: 'expired_unconfirmed_or_finished_records', running: 'locally_confirmed_active_invocations' } };
    return counts;
  }
  function countRecord(counts, record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) { counts.invalid_records++; return; }
    const { kind, current } = classify(record);
    if (current) counts[kind]++;
    else { counts.history.total++; counts.history[kind]++; }
  }
  const isRecord = name => /^[a-f0-9-]{36}\.json$/.test(name);
  function summary() {
    const counts = emptyCounts();
    for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir).filter(isRecord) : []) {
      let record;
      try { record = read(entry.slice(0, -5)); if (!record || typeof record !== 'object') throw Error('invalid record'); }
      catch { counts.invalid_records++; continue; }
      countRecord(counts, record);
    }
    return counts;
  }
  async function summaryAsync() {
    const counts = emptyCounts();
    let entries;
    try { entries = (await fs.promises.readdir(dir)).filter(isRecord); }
    catch (error) { if (error.code === 'ENOENT') return counts; throw error; }
    // Bounded local disk concurrency; history reads must not block protocol ping.
    for (let i = 0; i < entries.length; i += 8) {
      await Promise.all(entries.slice(i, i + 8).map(async entry => {
        try { countRecord(counts, JSON.parse(await fs.promises.readFile(path.join(dir, entry), 'utf8'))); }
        catch { counts.invalid_records++; }
      }));
    }
    return counts;
  }
  return { run, resume, summary, summaryAsync };
}
module.exports = { createOperations, errorData };
