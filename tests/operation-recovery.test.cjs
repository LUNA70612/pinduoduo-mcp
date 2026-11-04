'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createOperations } = require('../tools/operations.cjs');
const base = path.join(__dirname, '..', 'work', 'test-operations');
fs.mkdirSync(base, { recursive: true });
function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(base, 'classified-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let time = Date.parse('2026-11-04T06:00:00Z');
  return { dir, operations: createOperations({ dir, now: () => time, ...options }),
    advance: ms => { time += ms; },
    blocked: (status = 'verification_required') => ({ status, page_evidence: { kind: status === 'auth_required' ? 'login_wall' : 'verification', source: 'visible_page', observed_at: new Date(time).toISOString() } }),
    write: record => { const id = randomUUID(); fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ resume_id: id, tool: 'pdd_search', args: { query: '耳机' }, ...record })); return id; } };
}
const session = async () => ({ status: 'session_ok', logged_in: true });
const never = async () => assert.fail('must not replay');

test('only fresh page evidence creates a human waiting task; infrastructure errors keep their outcomes', async t => {
  const s = setup(t);
  for (const status of ['auth_required', 'verification_required', 'timeout', 'page_loading', 'service_unavailable', 'browser_disconnected', 'browser_target_missing', 'browser_busy', 'interrupted']) {
    const result = await s.operations.run('pdd_search', { query: '耳机' }, async () => ({ status }));
    assert.equal(result.status, status);
    assert.equal(result.waiting_for_user, false);
    assert.equal(result.recoverable, true);
  }
  const blocked = await s.operations.run('pdd_search', {}, async () => s.blocked());
  assert.equal(blocked.waiting_for_user, true);
  assert.equal(s.operations.summary().waiting, 1);
  assert.equal(s.operations.summary().recoverable, 9);
});
test('30 minute expiry moves records to history without modifying or deleting files', async t => {
  const s = setup(t);
  const r = await s.operations.run('pdd_search', {}, async () => s.blocked());
  const before = fs.readFileSync(path.join(s.dir, r.resume_id + '.json'), 'utf8');
  s.advance(1800000);
  const summary = s.operations.summary();
  assert.equal(summary.waiting, 0);
  assert.equal(summary.history.waiting, 1);
  assert.equal(summary.scope.current_ttl_ms, 1800000);
  assert.equal(fs.readFileSync(path.join(s.dir, r.resume_id + '.json'), 'utf8'), before);
  assert.equal((await s.operations.resume({ resume_id: r.resume_id, retry: true }, session, never)).status, 'recovery_expired');
});
test('legacy waits without page proof or timestamps are historical, not current human tasks', t => {
  const s = setup(t);
  s.write({ status: 'waiting_for_user', outcome: 'verification_required', finished_at: '2026-11-04T05:59:00Z' });
  s.write({ status: 'waiting_for_user', outcome: 'auth_required' });
  s.write({ status: 'waiting_for_user', outcome: 'timeout', finished_at: '2026-11-04T05:59:00Z' });
  const r = s.operations.summary();
  assert.equal(r.waiting, 0);
  assert.equal(r.recoverable, 1);
  assert.equal(r.history.waiting, 2);
});
test('live foreign PID does not prove an operation is running; dead owner never permits blind replay', async t => {
  const s = setup(t, { processState: pid => pid === 123 ? 'alive' : 'dead' });
  const live = s.write({ status: 'running', pid: 123, started_at: '2026-11-04T05:59:00Z' });
  const dead = s.write({ status: 'running', pid: 456, started_at: '2026-11-04T05:59:00Z' });
  assert.equal(s.operations.summary().running, 0);
  assert.equal(s.operations.summary().execution_unknown, 1);
  assert.equal(s.operations.summary().interrupted, 1);
  for (const id of [live, dead]) assert.equal((await s.operations.resume({ resume_id: id, retry: true }, session, never)).diagnostic, 'original_execution_unconfirmed');
});
test('active local invocation prevents resume even when record is old', async t => {
  const s = setup(t); let finish;
  const pending = s.operations.run('pdd_search', {}, () => new Promise(resolve => { finish = resolve; }));
  const id = fs.readdirSync(s.dir).find(f => f.endsWith('.json')).slice(0, -5);
  s.advance(1800001);
  assert.equal(s.operations.summary().running, 1);
  assert.equal((await s.operations.resume({ resume_id: id, retry: true }, session, never)).status, 'browser_busy');
  finish({ status: 'ok' }); await pending;
});
test('timeout with unknown underlying execution cannot replay even after a successful session check', async t => {
  const s = setup(t);
  const r = await s.operations.run('pdd_search', {}, async () => { throw Object.assign(Error('timeout'), { code: 'TIMEOUT' }); });
  assert.equal(r.execution_ended, false);
  assert.equal(r.retry_allowed, false);
  assert.equal((await s.operations.resume({ resume_id: r.resume_id, retry: true }, session, never)).diagnostic, 'original_execution_unconfirmed');
});
test('resume requires a valid search source before checking or replaying a detail', async t => {
  const s = setup(t);
  const r = await s.operations.run('pdd_read_item', { url: '123' }, async () => ({ status: 'browser_disconnected' }));
  for (const diagnostic of ['search_context_missing', 'search_context_expired']) {
    const data = await s.operations.resume({ resume_id: r.resume_id, retry: true }, never, never,
      () => ({ status: 'unsupported', diagnostic }));
    assert.equal(data.diagnostic, diagnostic); assert.equal(data.retried, false);
  }
  assert.equal((await s.operations.resume({ resume_id: r.resume_id, retry: true }, session, never)).diagnostic, 'search_context_unconfirmed');
});
test('check does not consume retry, explicit and concurrent recovery dispatch at most once', async t => {
  const s = setup(t); let calls = 0;
  const r = await s.operations.run('pdd_search', {}, async () => ({ status: 'page_loading' }));
  assert.equal((await s.operations.resume({ resume_id: r.resume_id }, session, never)).retried, false);
  const dispatch = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 15)); return { status: 'ok' }; };
  const results = await Promise.all([1, 2, 3].map(() => s.operations.resume({ resume_id: r.resume_id, retry: true }, session, dispatch)));
  assert.equal(calls, 1); assert.equal(results.filter(x => x.retried).length, 1);
  assert.equal((await s.operations.resume({ resume_id: r.resume_id, retry: true }, session, never)).status, 'already_finished');
});
test('underlying runtime lock prevents retry and failed dispatch cannot leave original request replayable', async t => {
  let idle = false; const s = setup(t, { executionIdle: () => idle });
  const r = await s.operations.run('pdd_search', {}, async () => ({ status: 'page_loading' }));
  assert.equal((await s.operations.resume({ resume_id: r.resume_id, retry: true }, session, never)).status, 'browser_busy');
  idle = true;
  const retried = await s.operations.resume({ resume_id: r.resume_id, retry: true }, session, async () => { throw Error('dispatch failure'); });
  assert.equal(retried.retried, true);
  assert.equal((await s.operations.resume({ resume_id: r.resume_id, retry: true }, session, never)).status, 'already_finished');
});
test('expired or unconfirmed page evidence never becomes a current human wait', async t => {
  const s = setup(t);
  for (const evidence of [ { kind: 'verification', source: 'visible_page', observed_at: '2026-11-04T05:00:00Z' }, { kind: 'verification', source: 'error_code', observed_at: '2026-11-04T06:00:00Z' } ]) {
    const r = await s.operations.run('pdd_search', {}, async () => ({ status: 'verification_required', page_evidence: evidence }));
    assert.equal(r.waiting_for_user, false);
  }
});
test('resume inspection never navigates or refreshes current page', async () => {
  const { perform } = require('../clis/pdd/_adapter.cjs');
  let inspected = 0;
  const result = await perform('resume', { url: () => 'https://mobile.yangkeduo.com/goods.html?goods_id=123', goto: never,
    evaluate: async script => { assert.ok(script.includes('"session"')); inspected++; return { status: 'session_unknown', logged_in: false }; } }, {}, { settle: false });
  assert.equal(inspected, 1); assert.equal(result.status, 'session_unknown');
});
test('async status summary equals sync summary and leaves malformed records on disk', async t => {
  const s = setup(t);
  await s.operations.run('pdd_search', {}, async () => s.blocked());
  fs.writeFileSync(path.join(s.dir, randomUUID() + '.json'), '{broken');
  assert.deepEqual(await s.operations.summaryAsync(), s.operations.summary());
  assert.equal(fs.readdirSync(s.dir).length, 2);
});
test('healthy resume inspection clears current human wait without consuming retry or renewing TTL', async t => {
  const s = setup(t);
  const r = await s.operations.run('pdd_search', {}, async () => s.blocked());
  const original = JSON.parse(fs.readFileSync(path.join(s.dir, r.resume_id + '.json')));
  s.advance(1000);
  await s.operations.resume({ resume_id: r.resume_id }, session, never);
  assert.equal(s.operations.summary().waiting, 0);
  assert.equal(s.operations.summary().recoverable, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir, r.resume_id + '.json'))).finished_at, original.finished_at);
});
test('independent processes can consume the same recovery record only once', async t => {
  const s = setup(t, { now: Date.now });
  const r = await s.operations.run('pdd_search', { query: '耳机' }, async () => ({ status: 'page_loading' }));
  const log = path.join(s.dir, 'dispatches.log');
  const { execFile } = require('node:child_process');
  const code = `const fs=require('node:fs');const {createOperations}=require('./tools/operations.cjs');const [dir,id,log]=process.argv.slice(1);createOperations({dir}).resume({resume_id:id,retry:true},async()=>({status:'session_ok',logged_in:true}),async()=>{fs.appendFileSync(log,'dispatch\\n');await new Promise(r=>setTimeout(r,50));return{status:'ok'};}).then(r=>process.stdout.write(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1});`;
  const run = () => new Promise((resolve, reject) => execFile(process.execPath, ['-e', code, s.dir, r.resume_id, log], { cwd: path.join(__dirname, '..'), windowsHide: true }, (e, out) => e ? reject(e) : resolve(JSON.parse(out))));
  const results = await Promise.all([run(), run()]);
  assert.equal(fs.readFileSync(log, 'utf8'), 'dispatch\n');
  assert.equal(results.filter(x => x.retried).length, 1);
});
test('source expiring while checking session stops before retry dispatch', async t => {
  const s = setup(t); let checks = 0;
  const r = await s.operations.run('pdd_read_sku', { goods_id: '123' }, async () => ({ status: 'page_loading' }));
  const result = await s.operations.resume({ resume_id: r.resume_id, retry: true }, session, never,
    () => ++checks === 1 ? { status: 'ok' } : { status: 'unsupported', diagnostic: 'search_context_expired' });
  assert.equal(result.diagnostic, 'search_context_expired'); assert.equal(result.retried, false);
});
test('DOM page evidence distinguishes visible login, verification and unknown without account data', () => {
  const { parseHTML } = require('linkedom');
  const { inspectPage } = require('../clis/pdd/_dom.cjs');
  for (const [html, kind] of [['<p>请先登录</p>', 'login_wall'], ['<p>请完成滑块验证</p>', 'verification']]) {
    const { document } = parseHTML('<html><body>' + html + '</body></html>');
    const result = inspectPage(document, new URL('https://mobile.yangkeduo.com/goods.html?goods_id=123'), 'session');
    assert.equal(result.page_evidence.kind, kind);
    assert.deepEqual(Object.keys(result.page_evidence).sort(), ['kind', 'observed_at', 'source']);
  }
  const { document } = parseHTML('<html><body>商品</body></html>');
  assert.equal(inspectPage(document, new URL('https://mobile.yangkeduo.com/goods.html?goods_id=123'), 'session').page_evidence, undefined);
});
test('page assistance evidence survives adapter runtime and OpenCLI envelope while preserving cooldown', async t => {
  const { execute } = require('../clis/pdd/_adapter.cjs');
  const { createRuntime } = require('../clis/pdd/_shared.cjs');
  for (const [status, code, kind] of [['auth_required','AUTH_REQUIRED','login_wall'],['verification_required','VERIFICATION_REQUIRED','verification']]) {
    const s = setup(t, { now: Date.now });
    const runner = createRuntime({ stateDir: path.join(s.dir, 'runtime'), interval: 0 });
    const page = { url: () => 'https://mobile.yangkeduo.com/search_result.html?search_key=test',
      evaluate: async () => ({ status, code, page_evidence: { kind, source:'visible_page', observed_at:new Date().toISOString() } }) };
    const client = require('../tools/client-core.cjs').createClient({ invoke: async () => ({ stdout: JSON.stringify({ ok:true, data:await execute('search',page,{query:'test'},runner) }) }) });
    const result = await s.operations.run('pdd_search',{query:'test'},()=>client.search({query:'test'}));
    assert.equal(result.status,status); assert.equal(result.waiting_for_user,true);
    assert.equal(s.operations.summary().waiting,1);
    assert.ok(runner.state().cooldown_ms>85000);
  }
});
