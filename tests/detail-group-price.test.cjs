'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{parseHTML}=require('linkedom');
const {inspectPage}=require('../clis/pdd/_dom.cjs');
const proof=require('./fixtures/pdd-group-price-2026-11-04.json');
function read(label){const {document}=parseHTML('<html><body><h1 class="tLYIg_Ju enable-select"></h1><span class="uPP2olgd"></span></body></html>');document.querySelector('h1').textContent=proof.title;document.querySelector('span').textContent=label;return inspectPage(document,{href:'https://mobile.yangkeduo.com/goods.html?goods_id='+proof.goods_id},'detail',{goods_id:proof.goods_id});}
test('observed multi-person group price remains conditional and never verifies a SKU',()=>{const r=read(proof.detail_prices[0]);assert.equal(r.status,'ok');assert.equal(r.price,'¥30.9');assert.equal(r.price_basis,'detail_conditional');assert.equal(r.offer_conditions,'多人团价');assert.equal(r.variant_price_verified,false);assert.equal(r.offer_eligibility_verified,false);const p=require('../clis/pdd/_comparison.cjs').withComparison(r,{budget_max:200}).price_assessment;assert.equal(p.reference_price,null);assert.equal(p.budget_status,'unknown');assert.equal(p.total_price_confirmed,false);});
test('unknown group price syntax and multiple amounts are never guessed',()=>{for(const label of ['多人团价¥?','多人团价¥30.9 ¥32','神秘多人价¥30.9']){const r=read(label);assert.equal(r.status,'unsupported');assert.equal(r.price,null);}});
test('observed ten-thousand-person offer parses as conditional and is excluded on cards',()=>{
 const observed=require('./fixtures/pdd-ten-thousand-group-2026-11-04.json');
 const r=read(observed.detail_prices[0]);assert.equal(r.status,'ok');assert.equal(r.offer_conditions,'万人团价');assert.equal(r.variant_price_verified,false);
 const filtered=require('../clis/pdd/_comparison.cjs').filterCatalog({status:'ok',results:[{goods_id:observed.goods_id,title:observed.title,price:'¥30.9',price_conditions:'万人团价'}]},{exclude_group_purchase:true});assert.equal(filtered.status,'empty');assert.equal(filtered.excluded_count,1);
});
