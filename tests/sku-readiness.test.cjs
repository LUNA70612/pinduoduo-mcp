'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {waitForSkuReadiness}=require('../clis/pdd/_adapter.cjs');
const pending=()=>({status:'unsupported',diagnostic:'sku_relationship_missing',spec_groups:[],skus:[],safe_entry_evidence:{candidates:[{reasons:['product_bound_dialog_missing']}]}});
test('observed modal hydration waits by reading without any click and returns bound groups',async()=>{
 let time=0,calls=0;
 const page={evaluate:async script=>{assert.ok(script.includes('"sku"'));assert.ok(!script.includes(',"spec_open",'));calls++;return calls===2?{status:'unsupported',spec_groups:[{label:'款式',options:['620ml','820ml']}],skus:[]}:pending();}};
 const result=await waitForSkuReadiness(page,{goods_id:'123'},pending(),{now:()=>time,pause:async ms=>{time+=ms;},timeout:2000});
 assert.equal(result.spec_groups.length,1);assert.equal(calls,2);
});
test('hydration deadline stays bounded and unsafe or unrelated missing entries never poll',async()=>{
 let time=0,calls=0;const page={evaluate:async()=>{calls++;return pending();}};
 const result=await waitForSkuReadiness(page,{goods_id:'123'},pending(),{now:()=>time,pause:async ms=>{time+=ms;},timeout:1000});
 assert.equal(result.diagnostic,'content_load_timeout');assert.equal(calls,2);assert.equal(time,1000);
 for(const reasons of [[],['unrecognized_footer_action'],['product_bound_dialog_missing','unsafe_control']]){
  const r=pending();r.safe_entry_evidence.candidates[0].reasons=reasons;calls=0;
  assert.equal(await waitForSkuReadiness(page,{goods_id:'123'},r),r);assert.equal(calls,0);
 }
});
