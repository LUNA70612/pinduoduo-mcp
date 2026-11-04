'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {parseHTML}=require('linkedom'),{inspectPage}=require('../clis/pdd/_dom.cjs'),{withComparison}=require('../clis/pdd/_comparison.cjs');
function read(change=()=>{}){const f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/pdd-asus-spec-open-2026-11-04.json'),'utf8'));change(f);const{document}=parseHTML('<html><body>'+f.html+'</body></html>');document.querySelector('[role=dialog]').__reactFiber$fixture={return:{memoizedProps:{goods:f.goods},stateNode:{state:f.state}}};return withComparison(inspectPage(document,new URL('https://mobile.yangkeduo.com/goods.html?goods_id='+f.goods_id),'sku',{goods_id:f.goods_id}),{budget_max:200});}
test('observed selected coupon SKU crosschecks cents, panel main price and separate group price',()=>{
 const r=read();assert.equal(r.status,'ok');const s=r.skus.find(s=>s.variant_price_verified);assert.equal(s.specs.颜色,'海洋蓝 云感佩戴 三年质保 极速发货');assert.equal(s.price,'29.9');assert.equal(s.group_price,'31.9');assert.equal(s.price_basis,'loaded_sku_coupon_price');assert.equal(s.price_assessment.reference_price,29.9);assert.equal(s.price_assessment.basis,'conditional_offer');assert.ok(s.price_assessment.unknowns.includes('offer_eligibility'));assert.equal(s.price_assessment.total_price_confirmed,false);assert.ok(r.skus.filter(s=>s!==r.skus[0]).every(s=>!s.variant_price_verified));
});
test('coupon crosscheck rejects mismatched cents, group label, stale selection and hidden panel',()=>{
 for(const mutate of [f=>f.state.skuInfos[String(f.state.selectedSkuID)].skuPrice=1,f=>f.state.skuInfos[String(f.state.selectedSkuID)].skuPrice='2990',f=>f.state.skuInfos[String(f.state.selectedSkuID)].groupPrice='99.99',f=>f.state.currentSelect.颜色='星空黑 云感佩戴 三年质保 极速发货',f=>f.html=f.html.replace('role="dialog"','hidden role="dialog"')]){
 const r=read(mutate);assert.equal(r.status,'unsupported');assert.ok(r.skus.every(s=>!s.variant_price_verified));assert.ok(r.skus.every(s=>s.price_assessment.reference_price===null));
 }
});
test('real non-default black supreme combination preserves its own coupon and group prices',()=>{
 const r=read(f=>Object.assign(f,JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/pdd-asus-spec-nondefault-2026-11-04.json'),'utf8'))));
 const s=r.skus.find(s=>s.variant_price_verified);assert.equal(r.status,'ok');assert.equal(r.safe_entry_status,'available');assert.equal(s.price_assessment.reference_price,39.9);assert.equal(s.group_price,'42.5');assert.equal(s.sku_id,'1934661664069');assert.equal(s.specs.颜色,'星空黑 云感佩戴 三年质保 极速发货');
});
test('real Lenovo flagship combination uses 39.5 instead of the 29.5 entry display price',()=>{
 const r=read(f=>Object.assign(f,JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/pdd-lenovo-spec-nondefault-2026-11-04.json'),'utf8'))));
 const s=r.skus.find(s=>s.variant_price_verified);assert.equal(r.status,'ok');assert.equal(s.sku_id,'1970006526028');assert.equal(s.price_assessment.reference_price,39.5);assert.equal(s.requires_group_purchase,false);assert.equal(s.price_assessment.basis,'conditional_offer');assert.ok(s.price_assessment.conditions.includes('大促价'));assert.equal(s.price_assessment.total_price_confirmed,false);
});
