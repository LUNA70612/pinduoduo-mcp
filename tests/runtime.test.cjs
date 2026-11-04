'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'work', 'test-runtime');
fs.mkdirSync(root, { recursive: true });
test('shared validator rejects invalid modes, quantities, and foreign URLs', () => {
  const { normalize } = require('../clis/pdd/_shared.cjs');
  for (const value of ['abc123', 'https://evil.test/?goods_id=123', 'https://mobile.yangkeduo.com.evil.test/?goods_id=123']) assert.throws(() => normalize('read_sku', { goods_id: value }));
  assert.throws(() => normalize('contact_seller', { goods_id: '123', mode: 'delete' }));
  assert.throws(() => normalize('add_cart', { goods_id: '123', quantity: 1.5 }));
  assert.throws(() => normalize('read_cart', { cursor: 'next' }));
  assert.equal(normalize('read_sku', { goods_id: 'https://mobile.yangkeduo.com/goods.html?x=1&goods_id=123' }).goods_id, '123');
});
test('request journal claims atomically and never repeats unknown writes', async () => {
  const { createRuntime } = require('../clis/pdd/_shared.cjs');
  const stateDir = fs.mkdtempSync(path.join(root, 'state-'));
  const runtime = createRuntime({ stateDir, interval: 0, enabled: () => true });
  const args = { goods_id: '123', confirm: true, request_id: 'test-request-0001' };
  let attempts = 0;
  const first = await runtime.run('add_cart', args, async () => { attempts++; throw Object.assign(Error('timeout'), { code: 'TIMEOUT' }); });
  assert.equal(first.status, 'result_unknown');
  await assert.rejects(runtime.run('add_cart', args, async () => { attempts++; }), e => e.code === 'DUPLICATE_REQUEST');
  assert.equal(attempts, 1);
});
test('two runtime instances serialize tasks and recover from errors', async () => {
  const { createRuntime } = require('../clis/pdd/_shared.cjs');
  const stateDir = fs.mkdtempSync(path.join(root, 'queue-'));
  const a = createRuntime({ stateDir, interval: 0 });
  const b = createRuntime({ stateDir, interval: 0 });
  let active = 0;
  const op = async () => { assert.equal(++active, 1); await new Promise(r => setTimeout(r, 20)); active--; return { status: 'ok' }; };
  await Promise.all([a.run('resume', {}, op), b.run('resume', {}, op)]);
  await assert.rejects(a.run('resume', {}, async () => { throw Error('boom'); }));
  assert.equal((await b.run('resume', {}, op)).status, 'ok');
});
test('environment flag alone cannot bypass acceptance; explicit test mode is separate', () => {
  const { writePermission } = require('../clis/pdd/_shared.cjs');
  const dir = fs.mkdtempSync(path.join(root, 'gate-'));
  assert.equal(writePermission('add_cart', { PDD_ENABLE_WRITES: '1' }, dir), false);
  assert.equal(writePermission('add_cart', { PDD_ENABLE_WRITES: '1', PDD_WRITE_TEST_MODE: '1' }, dir), true);
});
test('verification failure persists an extended cooldown', async () => {
  const { createRuntime } = require('../clis/pdd/_shared.cjs');
  const stateDir = fs.mkdtempSync(path.join(root, 'verify-'));
  const r = createRuntime({ stateDir, interval: 0 });
  await assert.rejects(r.run('resume', {}, async () => { throw Object.assign(Error('captcha'), { code: 'VERIFICATION_REQUIRED' }); }));
  assert.ok(r.state().cooldown_ms > 88000);
  assert.equal(r.state().locked, false);
});
test('separate Node processes cannot overlap browser operations', async () => {
  const { spawn } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(root, 'process-'));
  const code = `const fs=require('node:fs');const {createRuntime}=require('./clis/pdd/_shared.cjs');const dir=process.argv[1];const log=require('node:path').join(dir,'order.txt');createRuntime({stateDir:dir,interval:0}).run('resume',{},async()=>{fs.appendFileSync(log,'start\\n');await new Promise(r=>setTimeout(r,60));fs.appendFileSync(log,'end\\n');return {status:'ok'}}).catch(e=>{console.error(e);process.exitCode=1});`;
  const run = () => new Promise((resolve, reject) => { const child = spawn(process.execPath, ['-e', code, dir], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'ignore', 'pipe'] }); let err='';child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('exit',n=>n===0?resolve():reject(Error(err))); });
  await Promise.all([run(), run()]);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'order.txt'), 'utf8').trim().split(/\r?\n/), ['start', 'end', 'start', 'end']);
});
