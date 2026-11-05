'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const { inspectPage } = require('../clis/pdd/_dom.cjs');
const { withComparison } = require('../clis/pdd/_comparison.cjs');
const { waitForSelectedSku, waitForSelection } = require('../clis/pdd/_adapter.cjs');
const fixture = require('./fixtures/pdd-cpu-model-synthetic.json');

// Only labels/state are simulated. Reads and public option clicks execute the
// production DOM reader; this does not establish live layout compatibility.
function scene({ count = 4, long = false, extraGroup = true } = {}) {
  const models = [...fixture.models.slice(0, -1)];
  for (let i = models.length; i < count - 1; i++) models.push({ value: `其他型号${i}`, price: String(600 + i) });
  models.push(fixture.models.at(-1));
  const value = m => long ? `AMD 锐龙 ${m.value} 处理器（长选项，保留完整型号）` : m.value;
  const groups = [{ label: '型号', values: models.map(value) }, ...(extraGroup ? [{ label: '包装', values: [fixture.package] }] : [])];
  const specs = model => ({ 型号: value(model), ...(extraGroup ? { 包装: fixture.package } : {}) });
  const option = (v, picked) => `<div role="button" aria-label="${v}" class="F7sZG3xe${picked ? ' hr353bdX' : ''}"><span>${v}</span></div>`;
  const html = `<span class="tLYIg_Ju enable-select">${fixture.title}</span><span data-price="559">¥559</span>` +
    `<div role="dialog" class="HidQ9ROd"><div class="ujEqGzEB">¥559</div><span class="Mbx2m60G"></span>` +
    groups.map(g => `<div class="bIhLWVqm" style="display:flex;flex-wrap:wrap"><span class="sku-specs-key">${g.label}</span>${g.values.map((v, i) => option(v, i === 0)).join('')}</div>`).join('') + '</div>';
  const { document } = parseHTML('<html><body>' + html + '</body></html>');
  const dialog = document.querySelector('[role=dialog]');
  const state = { selectedSkuID: 100, currentSelect: specs(models[0]), skuInfos: {}, typeHashToSkuID: {} };
  models.forEach((m, i) => {
    state.typeHashToSkuID[JSON.stringify(specs(m))] = 100 + i;
    state.skuInfos[100 + i] = { skuId: 100 + i, skuID: 100 + i, goodsId: Number(fixture.goods_id), groupPrice: m.price, isOnsale: 1 };
  });
  const goods = { goodsID: Number(fixture.goods_id), goodsName: fixture.title };
  dialog.__reactFiber$fixture = { return: { memoizedProps: { goods }, stateNode: { state } } };
  let clicks = 0;
  function select(index, updatePrice = true) {
    const m = models[index];
    state.selectedSkuID = 100 + index;
    state.currentSelect = specs(m);
    for (const [i, group] of [...dialog.querySelectorAll('.bIhLWVqm')].entries()) {
      for (const e of group.querySelectorAll('.F7sZG3xe')) e.classList.toggle('hr353bdX', e.getAttribute('aria-label') === state.currentSelect[groups[i].label]);
    }
    dialog.querySelector('.Mbx2m60G').textContent = '已选：' + Object.values(state.currentSelect).join(' ');
    if (updatePrice) dialog.querySelector('.ujEqGzEB').textContent = '¥' + m.price;
  }
  select(0);
  for (const e of dialog.querySelectorAll('.F7sZG3xe')) e.addEventListener('click', () => clicks++);
  const read = (kind = 'sku', args = {}) => inspectPage(document, new URL(`https://mobile.yangkeduo.com/goods.html?goods_id=${fixture.goods_id}`), kind, { goods_id: fixture.goods_id, ...args });
  return { document, dialog, state, goods, models, groups, specs, select, read, clicks: () => clicks, target: specs(models.at(-1)) };
}

for (const layout of [{ count: 4 }, { count: 30 }, { count: 30, long: true }, { count: 4, extraGroup: false }]) {
  test(`mixed CPU models keep target identity and price across synthetic layout ${JSON.stringify(layout)}`, () => {
    const s = scene(layout);
    const initial = withComparison(s.read(), { budget_max: 600 });
    const defaultSku = initial.skus.find(r => r.variant_price_verified);
    assert.equal(defaultSku.specs.型号, s.specs(s.models[0]).型号);
    assert.equal(defaultSku.price_assessment.reference_price, 559);
    assert.notEqual(defaultSku.specs.型号, s.target.型号);
    assert.ok(s.read().spec_groups.find(g => g.label === '型号').options.includes(s.target.型号));
    const before = withComparison(s.read('sku', { spec_selection: s.target }), { budget_max: 600 });
    assert.notEqual(before.status, 'ok');
    assert.ok(before.skus.every(r => !r.variant_price_verified && r.price_assessment.reference_price === null));
    const targetNode = [...s.dialog.querySelectorAll('.F7sZG3xe')].find(e => e.getAttribute('aria-label') === s.target.型号);
    targetNode.addEventListener('click', () => s.select(s.models.length - 1));
    assert.equal(s.read('spec_click', { label: '型号', value: s.target.型号 }).selected, true);
    assert.equal(s.clicks(), 1);
    const after = withComparison(s.read('sku', { spec_selection: s.target }), { budget_max: 600 });
    assert.equal(after.status, 'ok');
    assert.equal(after.skus.length, 1);
    assert.deepEqual(after.skus[0].specs, s.target);
    assert.equal(after.skus[0].price_assessment.reference_price, 939);
    assert.equal(after.skus[0].price_assessment.budget_status, 'over_budget');
  });
}

test('stale panel price or changed product never verifies the requested CPU', () => {
  for (const mutation of [s => s.select(3, false), s => { s.select(3); s.goods.goodsID++; }, s => { s.select(3); s.dialog.querySelector('.Mbx2m60G').textContent = '已选：5500 散片 单CPU'; }]) {
    const s = scene(); mutation(s);
    const r = withComparison(s.read('sku', { spec_selection: s.target }), { budget_max: 600 });
    assert.notEqual(r.status, 'ok');
    assert.ok(r.skus.every(row => !row.variant_price_verified && row.price_assessment.reference_price === null));
  }
});

test('duplicate, disabled and purchase-like options are rejected without a click', () => {
  for (const mutation of [e => e.parentElement.appendChild(e.cloneNode(true)), e => e.setAttribute('aria-disabled', 'true'), e => e.textContent = '立即购买 5600GT']) {
    const s = scene(), target = s.dialog.querySelector('[aria-label="5600GT"]'); mutation(target);
    assert.notEqual(s.read('spec_click', { label: '型号', value: '5600GT' }).selected, true);
    assert.equal(s.clicks(), 0);
  }
});

test('CPU async price must settle and a click leaving the old model cannot succeed', async () => {
  const s = scene(); let time = 0, reads = 0;
  s.select(3, false);
  const settled = await waitForSelectedSku(null, { spec_selection: s.target }, {
    now: () => time, pause: async ms => { time += ms; }, timeout: 2000,
    read: () => { if (++reads === 3) s.select(3); return s.read('sku', { spec_selection: s.target }); }
  });
  assert.equal(settled.status, 'ok');
  assert.equal(reads, 4);
  assert.equal(settled.skus[0].price, '939');
  s.select(0); time = 0;
  const unchanged = await waitForSelection(null, { spec_selection: s.target }, { now: () => time, pause: async ms => { time += ms; }, timeout: 500, read: () => s.read('selection') });
  assert.equal(unchanged.diagnostic, 'selected_specs_mismatch');
  time = 0;
  const failed = await waitForSelectedSku(null, { spec_selection: s.target }, { now: () => time, pause: async ms => { time += ms; }, timeout: 500, read: () => s.read('sku', { spec_selection: s.target }) });
  assert.equal(failed.diagnostic, 'selected_price_update_unconfirmed');
  assert.ok(failed.skus.every(row => !row.variant_price_verified));
});

test('all client surfaces distinguish verified default price from requested exact model', () => {
  const { instructions, getPrompt, prompts } = require('../tools/shopping-prompts.cjs');
  const texts = [instructions, ...prompts.map(p => getPrompt({ name: p.name, arguments: { request: '找便宜的5600GT CPU' } }).messages[0].content.text)];
  for (const text of texts) {
    assert.match(text, /型号硬条件：/);
    assert.match(text, /5500、5600、5600G、5600GT/);
    assert.match(text, /默认组合已核价不等于符合目标型号/);
    assert.match(text, /型号匹配.*规格价核验/);
    assert.match(text, /不能用商品最低价.*目标型号参考价/);
  }
});
