'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createOperations } = require('../tools/operations.cjs');
const base = path.join(__dirname, '..', 'work', 'test-operations');
fs.mkdirSync(base, { recursive: true });

test('operation summary ignores legacy click receipts but still reads actual recovery tasks',async()=>{
 const dir=fs.mkdtempSync(path.join(base,'receipt-'));
 try{fs.writeFileSync(path.join(dir,'search-product-entry.json'),JSON.stringify({goods_id:'123',document_id:1}));const operations=createOperations({dir});
 await operations.run('pdd_search',{query:'耳机'},async()=>({status:'verification_required',page_evidence:{kind:'verification',source:'visible_page',observed_at:new Date().toISOString()}}));
 assert.equal(operations.summary().waiting,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('blocked read survives restart; check does not replay and explicit retry runs once', async () => {
  const dir = fs.mkdtempSync(path.join(base, 'resume-'));
  const a = createOperations({ dir });
  const blocked = await a.run('pdd_search', { query: '耳机' }, async () => { throw Object.assign(Error('人工验证'), { code: 'VERIFICATION_REQUIRED' }); });
  assert.equal(blocked.status, 'verification_required');
  assert.ok(blocked.resume_id);
  const b = createOperations({ dir });
  let calls = 0;
  const dispatch = async (tool, args) => { calls++; assert.equal(tool, 'pdd_search'); assert.deepEqual(args, { query: '耳机' }); return { status: 'ok', count: 1 }; };
  const check = async () => ({ status: 'session_ok', logged_in: true });
  assert.equal((await b.resume({ resume_id: blocked.resume_id }, check, dispatch)).retried, false);
  assert.equal(calls, 0);
  assert.equal((await b.resume({ resume_id: blocked.resume_id, retry: true }, check, dispatch)).status, 'ok');
  assert.equal((await b.resume({ resume_id: blocked.resume_id, retry: true }, check, dispatch)).status, 'already_finished');
  assert.equal(calls, 1);
});
test('recovery never records or replays write arguments and chat messages', async () => {
  const dir = fs.mkdtempSync(path.join(base, 'write-'));
  const operations = createOperations({ dir });
  await operations.run('pdd_contact_seller', { mode: 'send', message: 'SECRET' }, async () => ({ status: 'disabled' }));
  await operations.run('pdd_add_cart', { confirm: true }, async () => ({ status: 'disabled' }));
  assert.deepEqual(fs.readdirSync(dir), []);
  await assert.rejects(operations.resume({ resume_id: '../escape' }, async () => {}, async () => {}), error => error.code === 'INVALID_ARGUMENT');
  const id = '00000000-0000-0000-0000-000000000000';
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ tool: 'pdd_contact_seller', args: { mode: 'send' }, status: 'waiting_for_user' }));
  await assert.rejects(operations.resume({ resume_id: id, retry: true }, async () => ({ status: 'session_ok' }), async () => { throw Error('must not send'); }), error => error.code === 'INVALID_ARGUMENT');
});
test('incomplete login evidence cannot replay, old waiting task does not block new reads', async () => {
  const operations = createOperations({ dir: fs.mkdtempSync(path.join(base, 'session-')) });
  const old = await operations.run('pdd_read_cart', {}, async () => ({ status: 'auth_required' }));
  const data = await operations.resume({ resume_id: old.resume_id, retry: true }, async () => ({ status: 'session_unknown', logged_in: false }), async () => { throw Error('must not replay'); });
  assert.equal(data.retried, false);
  assert.equal((await operations.run('pdd_search', { query: '新任务' }, async () => ({ status: 'ok' }))).status, 'ok');
  assert.equal(operations.summary().waiting, 0);
  assert.equal(operations.summary().recoverable, 1);
});
