'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const { inspectPage } = require('../clis/pdd/_dom.cjs');
const fixture = require('./fixtures/pdd-cpu-stock-2026-11-05.json');

const target = 'R5 5600GT 全新散片（带集显）';
function scene(index = 0, change = () => {}) {
  const sample = structuredClone(fixture.samples[index]);
  change(sample);
  // Only inventory, identities and disabled controls are observed. These prices
  // and minimal DOM are synthetic so they cannot become live price evidence.
  const title = 'CPU 库存诊断测试';
  const html = '<h1 data-goods-title>' + title + '</h1><div data-main-price>¥100</div>' +
    '<div role="dialog" class="HidQ9ROd"><div class="ujEqGzEB">¥100</div>' +
    '<div class="Mbx2m60G">已选：' + Object.values(sample.selected).join(' ') + '</div>' +
    sample.groups.map(g => '<div class="bIhLWVqm"><span class="sku-specs-key">' + g.label + '</span>' +
      g.options.map(o => '<div role="button" aria-label="' + o.value + '" class="F7sZG3xe' +
        (o.selected ? ' hr353bdX' : '') + (o.disabled ? ' uRVpnTQ1' : '') + '">' + o.value + '</div>').join('') + '</div>').join('') + '</div>';
  const { document } = parseHTML('<html><body>' + html + '</body></html>');
  const state = { currentSelect: sample.selected, selectedSkuID: sample.selected_sku_id, typeHashToSkuID: {}, skuInfos: {} };
  for (const row of sample.rows) {
    state.typeHashToSkuID[JSON.stringify(row.specs)] = row.sku_id;
    state.skuInfos[row.sku_id] = { goodsId: sample.goods_id, skuID: row.sku_id, skuId: row.sku_id, groupPrice: '100', quantity: row.quantity, isOnsale: row.isOnsale };
  }
  const goods = { goodsID: sample.goods_id, goodsName: title };
  document.querySelector('[role=dialog]').__reactFiber$fixture = { return: { memoizedProps: { goods }, stateNode: { state } } };
  const read = (selection, kind = 'sku') => inspectPage(document, new URL('https://mobile.yangkeduo.com/goods.html?goods_id=' + sample.goods_id), kind,
    { goods_id: sample.goods_id, ...(selection ? { spec_selection: selection } : {}) });
  return { sample, state, goods, read };
}
const option = result => result.spec_groups.find(g => g.label === '型号').option_states.find(o => o.value === target);

test('observed zero SKU quantity is distinct from on-sale and disabled UI without verifying its price', () => {
  const r = scene().read({ 型号: target, 套餐: '单CPU' });
  assert.equal(r.status, 'unsupported');
  assert.equal(r.diagnostic, 'selected_price_unverified');
  assert.equal(r.selection_status, 'price_unconfirmed');
  assert.equal(r.skus.length, 1);
  const row = r.skus[0];
  assert.equal(row.stock, 0);
  assert.equal(row.available, true);
  assert.equal(row.selection_available, false);
  assert.equal(row.unselectable_reason, 'page_stock_zero');
  assert.equal(row.variant_price_verified, false);
  assert.equal(row.field_evidence.stock.source, 'product_bound_sku_quantity');
  assert.equal(row.field_evidence.stock.verified, true);
});

test('positive page quantity preserves selected SKU price verification', () => {
  const r = scene(1).read();
  const row = r.skus.find(s => s.variant_price_verified);
  assert.equal(r.status, 'ok');
  assert.equal(r.selection_status, 'verified');
  assert.equal(row.sku_id, '1946840410856');
  assert.equal(row.stock, 20);
  assert.equal(row.unselectable_reason, null);
  assert.equal(row.field_evidence.stock.verified, true);
});

test('a disabled model beyond the three returned SKUs explains zero stock across both complete packages', () => {
  const r = scene().read();
  assert.equal(r.skus.length, 3);
  assert.ok(!r.skus.some(s => s.specs.型号 === target));
  const o = option(r);
  assert.equal(o.selectable, false);
  assert.equal(o.reason, 'disabled_control');
  assert.equal(o.unselectable_reason, 'page_stock_zero');
  assert.equal(o.stock_evidence.quantity, 0);
  assert.equal(o.stock_evidence.combination_count, 2);
  assert.equal(o.stock_evidence.scope, 'all_mapped_combinations_for_option');
});

test('one sold-out package cannot mark the whole model as zero stock', () => {
  const r = scene(0, s => { s.rows.find(row => row.specs.型号 === target && row.specs.套餐 !== '单CPU').quantity = 4; }).read();
  assert.equal(option(r).unselectable_reason, 'disabled_control');
  assert.equal(option(r).stock_evidence, undefined);
});

test('missing package linkage or unknown quantity cannot establish model-wide zero stock', () => {
  for (const change of [
    s => { s.rows.find(row => row.specs.型号 === target && row.specs.套餐 !== '单CPU').quantity = undefined; },
    s => { s.rows = s.rows.filter(row => !(row.specs.型号 === target && row.specs.套餐 !== '单CPU')); }
  ]) {
    const o = option(scene(0, change).read());
    assert.equal(o.unselectable_reason, 'disabled_control');
    assert.equal(o.stock_evidence, undefined);
  }
});

test('absent or invalid quantity stays unknown despite other zero or positive inventory-like fields', () => {
  for (const quantity of [undefined, null, '0', -1, 0.5, NaN, Infinity, true, Number.MAX_SAFE_INTEGER + 1]) {
    const s = scene(1);
    const sku = s.state.skuInfos['1972248502805'];
    Object.assign(sku, { quantity, initQuantity: 0, defaultQuantity: 0, limitQuantity: 999999 });
    const r = s.read({ 型号: target }), row = r.skus[0];
    assert.equal(row.stock, null);
    assert.equal(row.field_evidence.stock.verified, false);
    assert.equal(row.unselectable_reason, 'disabled_control');
    assert.equal(option(r).unselectable_reason, 'disabled_control');
  }
});

test('disabled control with positive quantity keeps the original disabled reason', () => {
  const r = scene(1, s => { s.rows.find(row => row.specs.型号 === target).quantity = 3; }).read({ 型号: target });
  assert.equal(r.skus[0].stock, 3);
  assert.equal(r.skus[0].selection_available, false);
  assert.equal(r.skus[0].unselectable_reason, 'disabled_control');
  assert.equal(r.skus[0].variant_price_verified, false);
});

test('quantity evidence never changes UI click protection or guesses selectability', () => {
  const s = scene(1, f => { f.rows.find(row => row.specs.型号 === target).quantity = 0; f.groups[0].options.find(o => o.value === target).disabled = false; });
  const r = s.read({ 型号: target });
  assert.equal(r.skus[0].stock, 0);
  assert.equal(r.skus[0].selection_available, null);
  assert.equal(option(r).selectable, null);
  assert.equal(option(r).unselectable_reason, null);
  assert.equal(option(r).stock_evidence, undefined);
  const disabled = scene(1).read();
  assert.equal(option(disabled).selectable, false);
});

test('page observable quantity getter is read once without using inventory fallbacks', () => {
  const s = scene(1), sku = s.state.skuInfos['1972248502805'];
  let reads = 0;
  Object.defineProperty(sku, 'quantity', { get() { reads++; return 0; } });
  Object.defineProperty(sku, 'initQuantity', { get() { throw Error('not a quantity source'); } });
  const r = s.read({ 型号: target });
  assert.equal(r.skus[0].stock, 0);
  assert.equal(reads, 1);
});

test('an unreadable page quantity remains unknown without aborting the SKU result', () => {
  const s = scene(1);
  Object.defineProperty(s.state.skuInfos['1972248502805'], 'quantity', { get() { throw Error('page value unavailable'); } });
  const r = s.read({ 型号: target });
  assert.equal(r.skus[0].stock, null);
  assert.equal(r.skus[0].field_evidence.stock.verified, false);
  assert.equal(r.skus[0].unselectable_reason, 'disabled_control');
});

test('another product or broken later SKU linkage cannot publish trusted inventory evidence', () => {
  for (const change of [s => { s.goods.goodsID = '1'; }, s => { s.state.skuInfos['1972248502805'].goodsId = '1'; }]) {
    const s = scene(1); change(s);
    const r = s.read();
    assert.equal(r.status, 'unsupported');
    assert.equal(r.diagnostic, 'bound_sku_state_mismatch');
    assert.deepEqual(r.skus, []);
    assert.ok(r.spec_groups.every(g => g.option_states.every(o => !o.stock_evidence)));
  }
});

test('new inventory diagnostics are declared for clients and accepted by the existing output validator', () => {
  const pdd = require('../tools/pdd.cjs');
  const schema = pdd.tools.find(t => t.name === 'pdd_read_sku').outputSchema;
  assert.equal(schema.properties.skus.items.properties.stock.minimum, 0);
  assert.ok(schema.properties.skus.items.properties.unselectable_reason.enum.includes('page_stock_zero'));
  assert.ok(schema.properties.spec_groups.items.properties.option_states.items.properties.stock_evidence);
  const result = scene().read();
  pdd.validateSchema(schema, result);
  const saved = require('../scripts/recommendation-acceptance.cjs').sanitize(result);
  assert.equal(option(saved).unselectable_reason, 'page_stock_zero');
  assert.equal(option(saved).stock_evidence.combination_count, 2);
});
