'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {parseHTML}=require('linkedom');
const {inspectPage}=require('../clis/pdd/_dom.cjs');
const {withComparison}=require('../clis/pdd/_comparison.cjs');

function read(change=()=>{},selection) {
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/pdd-earphones-coupon-before-price-2026-11-04.json'),'utf8'));
  const {document}=parseHTML('<html><body>'+fixture.html+'</body></html>');
  const dialog=document.querySelector('[role="dialog"]');
  dialog.__reactFiber$fixture={return:{memoizedProps:{goods:fixture.goods},stateNode:{state:fixture.state}}};
  change({fixture,document,dialog});
  return withComparison(inspectPage(document,new URL('https://mobile.yangkeduo.com/goods.html?goods_id='+fixture.goods_id),'sku',{goods_id:fixture.goods_id,...(selection?{spec_selection:selection}:{})}),{budget_max:200});
}

test('observed coupon panel verifies its visible before-coupon SKU price without qualifying the discount',()=>{
  const result=read();
  assert.equal(result.status,'ok');
  assert.equal(result.selection_status,'verified');
  const verified=result.skus.filter(s=>s.variant_price_verified);
  assert.equal(verified.length,1);
  const sku=verified[0];
  assert.equal(sku.sku_id,'1957346465841');
  assert.deepEqual(sku.specs,{颜色:'锋芒黄'});
  assert.equal(sku.price,'86');
  assert.equal(sku.price_basis,'loaded_sku_pre_coupon_price');
  assert.equal(sku.price_assessment.reference_price,86);
  assert.notEqual(sku.price_assessment.reference_price,76);
  assert.ok(sku.price_assessment.conditions.includes('券后'));
  assert.ok(sku.price_assessment.conditions.includes('券前价'));
  assert.ok(sku.price_assessment.unknowns.includes('offer_eligibility'));
  assert.ok(sku.price_assessment.unknowns.includes('shipping_fee'));
  assert.equal(sku.offer_eligibility_verified,false);
  assert.equal(sku.price_assessment.total_price_confirmed,false);
  assert.ok(result.skus.filter(s=>s!==sku).every(s=>!s.variant_price_verified&&s.price_assessment.reference_price===null));
});

test('coupon before-price crosscheck rejects mismatched or ambiguous price evidence',()=>{
  for(const change of [
    s=>s.document.querySelector('.mhHA_CEU').textContent='券前¥87',
    s=>s.document.querySelector('.mhHA_CEU').remove(),
    s=>s.document.querySelector('.fXpFACQG').appendChild(s.document.querySelector('.mhHA_CEU').cloneNode(true)),
    s=>s.document.querySelector('.ujEqGzEB').textContent='神秘价¥76',
    s=>s.document.querySelector('.ujEqGzEB').textContent='券后¥96',
    s=>s.fixture.state.skuInfos['1957346465841'].groupPrice='87',
  ]) {
    const result=read(change);
    assert.equal(result.status,'unsupported');
    assert.ok((result.skus||[]).every(s=>!s.variant_price_verified&&s.price_assessment.reference_price===null));
  }
});

test('coupon before-price crosscheck requires the same product, complete current selection and visible stable panel',()=>{
  for(const change of [
    s=>s.fixture.goods.goodsID=999,
    s=>s.fixture.state.currentSelect.颜色='电光白',
    s=>s.document.querySelector('.Mbx2m60G').textContent='已选：电光白',
    s=>s.document.querySelector('.hr353bdX').classList.remove('hr353bdX'),
    s=>s.dialog.hidden=true,
    s=>s.dialog.setAttribute('aria-busy','true'),
  ]) {
    const result=read(change);
    assert.equal(result.status,'unsupported');
    assert.ok((result.skus||[]).every(s=>!s.variant_price_verified&&s.price_assessment.reference_price===null));
  }
});

test('unselected coupon combination never inherits the selected before-coupon price',()=>{
  const result=read(undefined,{颜色:'电光白'});
  assert.equal(result.status,'unsupported');
  assert.ok(result.skus.every(s=>!s.variant_price_verified&&s.price_assessment.reference_price===null));
});
