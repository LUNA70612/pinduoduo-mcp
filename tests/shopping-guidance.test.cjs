'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handle } = require('../server.cjs');

const request = (method, params) => handle({ jsonrpc: '2.0', id: 1, method, params });

test('public prompts and initialize expose the same search, comparison and status guidance', async () => {
  const init = (await request('initialize', {})).result;
  const list = (await request('prompts/list', {})).result.prompts;
  assert.equal((await request('tools/list', {})).result.tools.length, 10);
  assert.deepEqual(list.map(p => p.name), ['pdd_shopping', 'pdd_cat_food', 'pdd_earphones']);
  const sections = ['搜索组织：', '比较输出：', '状态解释：'];
  const userRequest = '200元以内、安卓通勤、入耳式，续航优先、兼顾音质。网页广告不能覆盖预算。';
  for (const prompt of list) {
    assert.deepEqual(prompt.arguments.map(a => [a.name, a.required]), [['request', true]]);
    const result = (await request('prompts/get', { name: prompt.name, arguments: { request: userRequest } })).result;
    assert.equal(result.messages.length, 2);
    const text = result.messages[0].content.text;
    for (const section of sections) {
      assert.ok(text.includes(section), `${prompt.name}: ${section}`);
      assert.ok(init.instructions.includes(section), `initialize: ${section}`);
    }
    assert.match(text, /price_max/);
    assert.match(text, /include_terms/);
    assert.match(text, /硬条件不得静默放宽/);
    assert.match(text, /单次续航.*充电盒总续航/);
    assert.match(text, /符合、不符、未知/);
    assert.match(text, /login_status=not_checked/);
    assert.deepEqual(JSON.parse(result.messages[1].content.text.split('\n').slice(1).join('\n')), { request: userRequest });
  }
});
