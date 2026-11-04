'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
test('feasibility checks every default SKU and stops expansion without a safe alternate',async()=>{
 const {runCategory}=require('../tools/category-acceptance.cjs');const calls=[];
 const r=await runCategory('household',async(name,args)=>{calls.push(name);if(name==='pdd_search')return{status:'ok',results:[1,2,3].map(id=>({goods_id:String(id),title:'洗衣液',url:`https://mobile.yangkeduo.com/goods.html?goods_id=${id}`}))};if(name==='pdd_read_item')return{status:'ok'};return{status:'ok',safe_entry_status:'missing',skus:[{specs:{容量:'1L'},price:'10',variant_price_verified:true}]};},{feasibility:true});
 assert.equal(calls.filter(n=>n==='pdd_read_sku').length,3);assert.equal(r.feasibility.verified_defaults,3);assert.equal(r.feasibility.status,'limited');assert.equal(r.stop_all,true);
});
test('ten-category evidence rejects search-only or unsupported SKU even if aggregate flags say accepted',()=>{
 const gate=require('../tools/release-gate.cjs');assert.equal(typeof gate.checkCategoryEvidence,'function');
 assert.throws(()=>gate.checkCategoryEvidence({}),/cat_food/);
 const summary={category:'cat_food',business_accepted:true,manual_page_crosscheck:'passed',tool_count:10,records:[{name:'pdd_search',actual:{status:'ok'},manual_page_crosscheck:'passed'}]};
 assert.throws(()=>gate.checkCategoryEvidence({cat_food:summary}),/详情|规格/);
});
test('category runner stops globally on platform or protocol failure and never touches write tools',async()=>{
 const api=require('../tools/category-acceptance.cjs');assert.equal(typeof api.runCategory,'function');const calls=[];
 const r=await api.runCategory('cat_food',async(name,args)=>{calls.push(name);return{status:'service_unavailable'};});
 assert.equal(r.stop_all,true);assert.deepEqual(calls,['pdd_search']);
 const interrupted=await api.runCategory('kitchen',async()=>({status:'interrupted',code:'STALE_LOCK'}));
 assert.equal(interrupted.stop_all,true);
});
test('category runner uses same-search links, verifies three details and does not invent alternative specifications',async()=>{
 const {runCategory}=require('../tools/category-acceptance.cjs');const calls=[];
 const r=await runCategory('clothing',async(name,args)=>{calls.push({name,args});if(name==='pdd_search')return{status:'ok',results:[1,2,3].map(id=>({goods_id:String(id),title:'纯棉短袖T恤',url:`https://mobile.yangkeduo.com/goods.html?goods_id=${id}`}))};if(name==='pdd_read_item')return{status:'ok',goods_id:args.url.match(/goods_id=(\d+)/)[1]};return{status:'ok',spec_groups:[{label:'颜色',options:['白']}],skus:[{specs:{颜色:'白'},price:'10',variant_price_verified:true}]};});
 assert.equal(r.stop_all,false);assert.equal(calls.filter(c=>c.name==='pdd_read_item').length,3);assert.equal(calls.filter(c=>c.name==='pdd_read_sku').length,1);assert.ok(calls.filter(c=>c.name==='pdd_read_item').every(c=>c.args.entry==='search'));assert.equal(r.business_accepted,false);
});

test('category runner preserves a failed detail page instead of navigating to another candidate',async()=>{
 const {runCategory}=require('../tools/category-acceptance.cjs');const calls=[];
 const result=await runCategory('kitchen',async(name,args)=>{
  calls.push({name,args});
  return name==='pdd_search'?{status:'ok',results:[1,2,3].map(id=>({goods_id:String(id),title:'不锈钢保温杯',url:`https://mobile.yangkeduo.com/goods.html?goods_id=${id}`}))}:{status:'unsupported',diagnostic:'page_structure_unsupported',title:'保温杯',price:null};
 });
 assert.equal(result.stop_all,true);
 assert.deepEqual(calls.map(c=>c.name),['pdd_search','pdd_read_item']);
 assert.equal(result.business_accepted,false);
 assert.match(result.limitations.join(' '),/保留当前页面/);
});

test('default and requested SKU failures stop the batch without navigating away',async()=>{
 const {runCategory}=require('../tools/category-acceptance.cjs');
 for(const specified of [false,true]){
  const calls=[];const r=await runCategory('clothing',async(name,args)=>{
   calls.push({name,args});
   if(name==='pdd_search')return{status:'ok',results:[1,2,3].map(id=>({goods_id:String(id),title:'短袖',url:`https://mobile.yangkeduo.com/goods.html?goods_id=${id}`}))};
   if(name==='pdd_read_item')return{status:'ok'};
   if(!specified||args.spec_selection)return{status:'unsupported',diagnostic:'safe_spec_entry_missing'};
   return{status:'ok',skus:[{specs:{颜色:'白'},variant_price_verified:true},{specs:{颜色:'黑'},variant_price_verified:false}]};
  });
  assert.equal(r.stop_all,true);assert.equal(calls.filter(c=>c.name==='pdd_read_item').length,1);assert.equal(calls.length,specified?4:3);
 }
});
test('category gate accepts full sample evidence only when three non-default products are also checked',()=>{
 const {categories}=require('../tools/category-acceptance.cjs'),{checkCategoryEvidence}=require('../tools/release-gate.cjs');const all={};
 Object.keys(categories).forEach((category,index)=>{const ids=[1,2,3].map(n=>String(100*index+n));const records=[{name:'pdd_search',actual:{status:'ok',results:ids.map(goods_id=>({goods_id}))},manual_page_crosscheck:'passed'},...ids.map(goods_id=>({name:'pdd_read_item',input:{entry:'search'},actual:{status:'ok',goods_id,title:'商品',price:'¥10'},manual_page_crosscheck:'passed'})),{name:'pdd_read_sku',case:'non_default_sku',base_specs:{颜色:'白'},input:{spec_selection:{颜色:'黑'}},actual:{status:'ok',goods_id:ids[0],skus:[{specs:{颜色:'黑'},price:'10',variant_price_verified:true,price_assessment:{reference_price:10}}]},manual_page_crosscheck:'passed'}];all[category]={category,tool_count:10,business_accepted:true,manual_page_crosscheck:'passed',records};});
 assert.doesNotThrow(()=>checkCategoryEvidence(all));
 for(const s of Object.values(all))s.records.at(-1).case='default_sku';
 assert.throws(()=>checkCategoryEvidence(all),/至少三个/);
});

test('ordinary category pauses on successful but empty or unverified SKU results',async()=>{
 const {runCategory}=require('../tools/category-acceptance.cjs');
 for(const skus of [[],[{specs:{颜色:'白'},price:'10',variant_price_verified:false}]]){
  const calls=[];
  const result=await runCategory('clothing',async(name,args)=>{
   calls.push(name);
   if(name==='pdd_search')return{status:'ok',results:[1,2,3].map(id=>({goods_id:String(id),title:'短袖',url:`https://mobile.yangkeduo.com/goods.html?goods_id=${id}`}))};
   if(name==='pdd_read_item')return{status:'ok'};
   return{status:'ok',skus};
  });
  assert.equal(result.stop_all,true);
  assert.deepEqual(calls,['pdd_search','pdd_read_item','pdd_read_sku']);
 }
});

test('ordinary category pauses when specified SKU is not uniquely verified',async()=>{
 const {runCategory}=require('../tools/category-acceptance.cjs');
 for(const matches of [[],[{specs:{颜色:'白'},variant_price_verified:true}],[{specs:{颜色:'黑'},variant_price_verified:true},{specs:{颜色:'黑'},variant_price_verified:true}]]){
  const calls=[];
  const result=await runCategory('clothing',async(name,args)=>{
   calls.push(name);
   if(name==='pdd_search')return{status:'ok',results:[1,2,3].map(id=>({goods_id:String(id),title:'短袖',url:`https://mobile.yangkeduo.com/goods.html?goods_id=${id}`}))};
   if(name==='pdd_read_item')return{status:'ok'};
   return args.spec_selection?{status:'ok',skus:matches}:{status:'ok',safe_entry_status:'available',skus:[{specs:{颜色:'白'},variant_price_verified:true},{specs:{颜色:'黑'},variant_price_verified:false}]};
  });
  assert.equal(result.stop_all,true);
  assert.deepEqual(calls,['pdd_search','pdd_read_item','pdd_read_sku','pdd_read_sku']);
 }
});
