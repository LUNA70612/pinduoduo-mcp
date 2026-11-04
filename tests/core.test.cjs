'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const wire = require('../tools/opencli-wire.cjs');

test('OpenCLI envelope retains nested cart objects', () => {
  const cart = { count: 1, items: [{ goods_id: '123' }] };
  assert.deepEqual(wire.parse(JSON.stringify({ ok: true, data: cart })), cart);
});
test('raw object and arrays retain their shape', () => {
  assert.deepEqual(wire.parse('{"logged_in":true}'), { logged_in: true });
  assert.deepEqual(wire.parse('[{"goods_id":"1"}]'), [{ goods_id: '1' }]);
});
test('empty list is distinct from invalid and failed output', () => {
  assert.deepEqual(wire.parse('{"ok":true,"data":[]}'), []);
  for (const raw of ['', 'garbage', '{"ok":false,"error":{"code":"AUTH_REQUIRED","message":"login"}}']) {
    assert.throws(() => wire.parse(raw));
  }
});
test('guard exposes verification block and supports deterministic serial tasks', async () => {
  const module = require('../tools/browser-guard.cjs');
  assert.equal(typeof module.browserGuard.blockFor, 'function');
  assert.equal(typeof module.createGuard, 'function');
  let now = 100;
  const waits = [];
  const guard = module.createGuard({ interval: 90, now: () => now, sleep: async ms => { waits.push(ms); now += ms; } });
  let active = 0;
  const tasks = [1, 2, 3].map(i => guard.run('read', async () => {
    assert.equal(++active, 1); await Promise.resolve(); active--; return i;
  }));
  assert.deepEqual(await Promise.all(tasks), [1, 2, 3]);
  assert.deepEqual(waits, [90, 90]);
  guard.blockFor(200);
  await guard.run('read', async () => {});
  assert.equal(waits.at(-1), 200);
});
test('failed task does not poison the queue', async () => {
  const { createGuard } = require('../tools/browser-guard.cjs');
  assert.equal(typeof createGuard, 'function');
  const guard = createGuard({ interval: 0 });
  await assert.rejects(guard.run('read', async () => { throw Error('failed'); }), /failed/);
  assert.equal(await guard.run('read', async () => 42), 42);
});

test('write operations stay disabled by default and reject malformed IDs', async t => {
  const old = process.env.PDD_ENABLE_WRITES;
  process.env.PDD_ENABLE_WRITES = '0';
  t.after(() => { if (old === undefined) delete process.env.PDD_ENABLE_WRITES; else process.env.PDD_ENABLE_WRITES = old; });
  const pdd = require('../tools/pdd.cjs');
  await assert.rejects(pdd.readSku({ goods_id: 'abc123' }), /goods_id/);
  const result = await pdd.addCart({ goods_id: '12345678', confirm: true });
  assert.equal(result.status, 'disabled');
});

test('non-empty cart cursor is explicitly unsupported', async () => {
  const pdd = require('../tools/pdd.cjs');
  await assert.rejects(pdd.readCart({ cursor: 'next' }), /不支持.*cursor/);
});
