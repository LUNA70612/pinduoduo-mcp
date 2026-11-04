'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {readCandidates}=require('../scripts/recommendation-acceptance.cjs');
const products=[{goods_id:'123',url:'https://mobile.yangkeduo.com/goods.html?goods_id=123'},{goods_id:'456',url:'https://mobile.yangkeduo.com/goods.html?goods_id=456'}];
test('recommendation runner preserves failed detail even when it contains a title',async()=>{
 const calls=[];const r=await readCandidates(products,async(name,args)=>{calls.push({name,args});return{status:'unsupported',title:'部分商品数据'};});assert.equal(r.stopped,true);assert.equal(r.stop_reason,'detail_read_failed');assert.equal(calls.length,1);
});
test('recommendation runner stops before next candidate on unsupported or unverified SKU',async()=>{
 for(const sku of [{status:'unsupported',diagnostic:'safe_spec_entry_missing'},{status:'ok',skus:[{variant_price_verified:false}]}]){
  const calls=[];const r=await readCandidates(products,async(name,args)=>{calls.push({name,args});return name==='pdd_read_item'?{status:'ok'}:sku;});assert.equal(r.stopped,true);assert.equal(r.stop_reason,'specification_unverified');assert.equal(calls.length,2);assert.equal(calls[1].args.goods_id,'123');assert.equal(calls[1].args.budget_max,200);
 }
});
test('verified default SKU can continue without a switching entry',async()=>{
 const calls=[];const r=await readCandidates(products,async(name,args)=>{calls.push({name,args});return name==='pdd_read_item'?{status:'ok'}:{status:'ok',safe_entry_status:'missing',skus:[{variant_price_verified:true}]};});assert.equal(r.stopped,false);assert.equal(calls.length,4);assert.equal(calls[2].args.url,products[1].url);
});
