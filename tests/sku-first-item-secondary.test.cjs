'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {parseHTML}=require('linkedom');
const {inspectPage}=require('../clis/pdd/_dom.cjs');
const {withComparison}=require('../clis/pdd/_comparison.cjs');
function read(mutate=()=>{},fixtureName='pdd-lenovo-first-item-secondary-2026-11-04.json') {
 const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures',fixtureName),'utf8'));
 const {document}=parseHTML('<html><body>'+fixture.html+'</body></html>');
 const dialog=document.querySelector('[role=dialog]');
 dialog.__reactFiber$fixture={return:{memoizedProps:{goods:fixture.goods},stateNode:{state:fixture.state}}};
 mutate({fixture,document,dialog});
 return withComparison(inspectPage(document,new URL('https://mobile.yangkeduo.com/goods.html?goods_id='+fixture.goods_id),'sku',{goods_id:fixture.goods_id,spec_selection:fixture.state.currentSelect}),{budget_max:200});
}
test('observed first-item and promotion panel verifies the selected secondary price conservatively',()=>{
 const r=read();assert.equal(r.status,'ok');assert.equal(r.selection_status,'verified');
 const sku=r.skus.find(x=>x.variant_price_verified);
 assert.equal(sku.sku_id,'1961412437644');assert.equal(sku.price,'44.9');
 assert.equal(sku.price_basis,'loaded_sku_secondary_price');
 assert.equal(sku.price_assessment.reference_price,44.9);assert.notEqual(sku.price_assessment.reference_price,39.9);
 assert.ok(sku.offer_conditions.includes('首件'));assert.ok(sku.offer_conditions.includes('大促价'));
 assert.ok(sku.price_assessment.unknowns.includes('offer_eligibility'));
 assert.equal(sku.price_assessment.budget_status,'conditional_within_budget');
 assert.equal(sku.price_assessment.total_price_confirmed,false);
});
test('first-item promotion crosscheck rejects unrelated, ambiguous and unstable secondary prices',()=>{
 for(const mutate of [
  s=>s.document.querySelector('.mhHA_CEU').textContent='大促价¥99.9',
  s=>s.document.querySelector('.mhHA_CEU').textContent='其他¥44.9',
  s=>s.document.querySelector('.mhHA_CEU').textContent='大促价¥44.9起',
  s=>s.document.querySelector('.fXpFACQG').appendChild(s.document.querySelector('.mhHA_CEU').cloneNode(true)),
  s=>s.document.querySelector('.ujEqGzEB').textContent='首件¥49.9',
  s=>s.dialog.setAttribute('aria-busy','true'),
 ]) {const r=read(mutate);assert.ok(!(r.skus||[]).some(x=>x.variant_price_verified));assert.ok((r.skus||[]).every(x=>x.price_assessment.reference_price===null));}
});
test('first-item promotion crosscheck still requires the same product, complete selection and visible panel',()=>{
 for(const mutate of [
  s=>s.fixture.goods.goodsID=999,
  s=>s.fixture.state.selectedSkuID=999,
  s=>s.document.querySelector('.hr353bdX').classList.remove('hr353bdX'),
  s=>s.document.querySelector('.Mbx2m60G').textContent='已选：其他规格',
  s=>s.dialog.hidden=true,
 ]) {const r=read(mutate);assert.ok(!(r.skus||[]).some(x=>x.variant_price_verified));assert.ok((r.skus||[]).every(x=>x.price_assessment.reference_price===null));}
});

test('observed M61 first-item subsidy verifies the higher SKU price without qualifying the first-item offer',()=>{
 const r=read(undefined,'pdd-kugou-first-item-subsidy-2026-11-04.json');
 assert.equal(r.status,'ok');assert.equal(r.selection_status,'verified');
 const sku=r.skus.find(x=>x.variant_price_verified);
 assert.equal(sku.sku_id,'1977530685119');
 assert.deepEqual(sku.specs,{'颜色':'【墨玉蓝】','款式':'4麦克主动降噪'});
 assert.equal(sku.price_basis,'loaded_sku_secondary_price');
 assert.equal(sku.price_assessment.reference_price,98.99);
 assert.notEqual(sku.price_assessment.reference_price,68.99);
 assert.ok(sku.price_assessment.conditions.includes('首件'));
 assert.ok(sku.price_assessment.conditions.includes('补贴价'));
 assert.ok(sku.price_assessment.unknowns.includes('offer_eligibility'));
 assert.ok(sku.price_assessment.unknowns.includes('shipping_fee'));
 assert.equal(sku.price_assessment.budget_status,'conditional_within_budget');
 assert.equal(sku.price_assessment.total_price_confirmed,false);
});

test('M61 subsidy still rejects conflicting amounts, ambiguous labels and stale product selection',()=>{
 for(const mutate of [
  s=>s.document.querySelector('.mhHA_CEU').textContent='补贴价¥99.99',
  s=>s.document.querySelector('.mhHA_CEU').textContent='补贴价¥98.99起',
  s=>s.document.querySelector('.mhHA_CEU').textContent='其他价¥98.99',
  s=>s.document.querySelector('.fXpFACQG').appendChild(s.document.querySelector('.mhHA_CEU').cloneNode(true)),
  s=>s.fixture.goods.goodsID=999,
  s=>s.fixture.state.selectedSkuID=999,
  s=>s.document.querySelector('.hr353bdX').classList.remove('hr353bdX'),
  s=>s.dialog.hidden=true,
 ]){
  const r=read(mutate,'pdd-kugou-first-item-subsidy-2026-11-04.json');
  assert.ok(!(r.skus||[]).some(x=>x.variant_price_verified));
  assert.ok((r.skus||[]).every(x=>x.price_assessment.reference_price===null));
 }
});
