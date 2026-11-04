'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const pdd = require('../tools/pdd.cjs');
const { handle } = require('../server.cjs');

for (const connected of [true, false]) {
  test(`status reports unchecked manual login without page actions when CDP connected=${connected}`, async t => {
    let connectionChecks = 0;
    t.mock.method(pdd, 'connected', async () => { connectionChecks++; return connected; });
    for (const method of ['search', 'readItem', 'readSku', 'browseHome', 'readCart', 'login', 'resume', 'addCart', 'contactSeller']) {
      t.mock.method(pdd, method, () => { throw Error(`Status must not call ${method}`); });
    }
    const historical = { waiting: 0, running: 0, recoverable: 0, history: { waiting: 7, total: 7 } };
    const store = {
      summaryAsync: async () => historical,
      run: () => { throw Error('Status must not create a page operation'); },
      resume: () => { throw Error('Status must not resume a page operation'); },
    };
    const response = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pdd_status', arguments: {} } }, store);
    const data = response.result.structuredContent;
    assert.equal(response.result.isError, false);
    assert.equal(data.status, 'ok');
    assert.equal(data.browser_connected, connected);
    assert.equal(data.user_login_required, true);
    assert.equal(data.login_status, 'not_checked');
    assert.equal(data.login_policy, 'manual');
    assert.equal(data.logged_in, undefined);
    assert.equal(data.waiting_for_user, undefined);
    assert.deepEqual(data.operations, historical);
    assert.equal(connectionChecks, 1);
    assert.deepEqual(JSON.parse(response.result.content[0].text), data);
  });
}

test('login schema additions belong only to status and preserve original tool inputs', () => {
  const status = pdd.tools.find(tool => tool.name === 'pdd_status');
  assert.deepEqual(status.inputSchema, { type: 'object', properties: {}, additionalProperties: false });
  assert.equal(status.outputSchema.properties.login_status.const, 'not_checked');
  assert.equal(status.outputSchema.properties.login_policy.const, 'manual');
  assert.match(status.outputSchema.properties.user_login_required.description, /不代表当前未登录/);
  for (const tool of pdd.tools.filter(tool => tool.name !== 'pdd_status')) {
    assert.equal(tool.outputSchema.properties.login_status, undefined);
    assert.equal(tool.outputSchema.properties.login_policy, undefined);
  }
});
