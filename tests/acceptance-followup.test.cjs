'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {planSelectionFollowup,runCategory}=require('../tools/category-acceptance.cjs');
function incomplete(){return{status:'unsupported',goods_id:'123',selection_status:'incomplete',safe_entry_status:'available',spec_groups:[{label:'颜色',options:['黑','白']},{label:'容量',options:['1L','2L']}],skus:[{sku_id:'1',specs:{颜色:'黑',容量:'1L'},available:true,variant_price_verified:false,field_evidence:{specs:{source:'product_bound_sku_state',verified:true}}},{sku_id:'2',specs:{颜色:'白',容量:'2L'},available:true,variant_price_verified:false,field_evidence:{specs:{source:'product_bound_sku_state',verified:true}}}]};}
test('selection followup uses one real complete unique mapped row, never a Cartesian guess',()=>{
 assert.deepEqual(planSelectionFollowup(incomplete(),'123'),{颜色:'黑',容量:'1L'});
});
test('selection followup skips a disabled UI combination even when loaded state says on sale',()=>{const r=incomplete();r.skus[0].selection_available=false;assert.deepEqual(planSelectionFollowup(r,'123'),r.skus[1].specs);});
test('selection followup rejects wrong product, unsafe entry, unbound or ambiguous combinations',()=>{
 for(const mutate of [r=>r.goods_id='999',r=>r.safe_entry_status='ambiguous',r=>r.selection_status='price_unconfirmed',r=>r.skus.forEach(s=>delete s.field_evidence),r=>r.skus.forEach(s=>delete s.specs.容量),r=>r.skus.push(...structuredClone(r.skus)),r=>r.spec_groups.push(structuredClone(r.spec_groups[0]))]){const r=incomplete();mutate(r);assert.equal(planSelectionFollowup(r,'123'),null);}
});
test('opt-in followup preserves unsupported call and establishes a distinct explicit selection request once',async()=>{
 const calls=[];const r=await runCategory('household',async(name,args,metadata)=>{
  calls.push({name,args,metadata});
  if(name==='pdd_search')return{status:'ok',results:[{goods_id:'123',title:'洗衣液',url:'https://mobile.yangkeduo.com/goods.html?goods_id=123'}]};
  if(name==='pdd_read_item')return{status:'ok',goods_id:'123'};
  if(!args.spec_selection)return incomplete();
  return{status:'ok',goods_id:'123',safe_entry_status:'available',skus:[{specs:args.spec_selection,price:'10',variant_price_verified:true,price_assessment:{reference_price:10}}]};
 },{selectionFollowup:true});
 assert.equal(r.stop_all,false);assert.equal(calls.length,5);assert.equal(calls[2].metadata.case,'default_sku');assert.equal(calls[3].metadata.case,'selection_followup');assert.deepEqual(calls[3].args.spec_selection,{颜色:'黑',容量:'1L'});assert.equal(calls[4].metadata.case,'non_default_sku');assert.deepEqual(calls[4].args.spec_selection,{颜色:'白',容量:'2L'});assert.equal(r.selection_followups,1);assert.equal(r.verified_specifications,1);
});
test('failed followup stops without replay, replacement or later detail navigation',async()=>{
 const calls=[];const r=await runCategory('household',async(name,args)=>{
  calls.push({name,args});if(name==='pdd_search')return{status:'ok',results:['123','456','789'].map(goods_id=>({goods_id,title:'洗衣液',url:'https://mobile.yangkeduo.com/goods.html?goods_id='+goods_id}))};if(name==='pdd_read_item')return{status:'ok'};return args.spec_selection?{status:'unsupported',diagnostic:'selected_specs_mismatch'}:incomplete();
 },{selectionFollowup:true});assert.equal(r.stop_all,true);assert.equal(calls.length,4);
});
