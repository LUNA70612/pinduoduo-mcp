'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {filterCatalog}=require('../clis/pdd/_comparison.cjs');
const {fromCLI,definition}=require('../clis/pdd/_adapter.cjs');
const {normalize}=require('../clis/pdd/_shared.cjs');
const card=(id,extra={})=>({goods_id:String(id),title:'耳机',price:'¥20',...extra});

test('group exclusion uses explicit card conditions before limit, including unknown prices',()=>{
 const data={status:'ok',results:[card(1,{price_conditions:'多人团价'}),card(2,{price:null,price_conditions:['3人成团']}),card(3,{price_conditions:'至少5人'}),card(4),card(5)]};
 assert.equal(filterCatalog(data,{limit:1}).results[0].goods_id,'1');
 const result=filterCatalog(data,{limit:1,exclude_group_purchase:true});
 assert.equal(result.scanned_count,5);assert.equal(result.matched_count,2);assert.equal(result.excluded_count,3);
 assert.equal(result.results[0].goods_id,'4');assert.equal(result.pending_count,0);assert.equal(result.truncated,true);
 assert.ok(result.excluded.every(x=>x.reasons.some(r=>r.code==='group_purchase_excluded')));
});

test('single-buy, ordinary discounts, unknown labels and non-group basis are not guessed as group prices',()=>{
 const data={status:'ok',results:[card(1,{price_conditions:'免拼购买'}),card(2,{price_conditions:'2件9折'}),card(3,{price_basis:'non_group'}),card(4,{price:null}),card(5,{price_basis:'list_group_price',requires_group_purchase:true,price_conditions:'拼单价'})]};
 const result=filterCatalog(data,{exclude_group_purchase:true});
 assert.deepEqual(result.results.map(x=>x.goods_id),['1','2','3','5']);assert.equal(result.pending_verification[0].goods_id,'4');assert.equal(result.excluded_count,0);
});

test('group filter boolean is validated and forwarded through MCP and CLI',async()=>{
 assert.equal(definition('search').args.some(a=>a.name==='exclude_group_purchase'),true);
 for(const value of [true,false,'true','false'])assert.equal(fromCLI('search',{query:'耳机',exclude_group_purchase:value}).exclude_group_purchase,value===true||value==='true');
 for(const value of ['yes','1',1,null])assert.throws(()=>fromCLI('search',{query:'耳机',exclude_group_purchase:value}),e=>e.code==='INVALID_ARGUMENT');
 assert.throws(()=>normalize('search',{query:'耳机',exclude_group_purchase:'true'}),e=>e.code==='INVALID_ARGUMENT');
 let flags;const client=require('../tools/client-core.cjs').createClient({invoke:async args=>{flags=args;return{stdout:JSON.stringify({ok:true,data:{status:'empty',results:[]}})};}});
 await client.search({query:'耳机',exclude_group_purchase:true});assert.equal(flags[flags.indexOf('--exclude_group_purchase')+1],'true');
 const {handle}=require('../server.cjs');const list=await handle({jsonrpc:'2.0',id:1,method:'tools/list'});
 assert.equal(list.result.tools.find(t=>t.name==='pdd_search').inputSchema.properties.exclude_group_purchase.type,'boolean');assert.equal(list.result.tools.length,10);
});

test('all recommendation prompts exclude explicit group prices even when only found in details',()=>{
 const {prompts,getPrompt}=require('../tools/shopping-prompts.cjs');assert.equal(prompts.length,3);
 for(const p of prompts){const text=getPrompt({name:p.name,arguments:{request:'200元内耳机'}}).messages[0].content.text;
 assert.match(text,/exclude_group_purchase:true/);assert.match(text,/详情或规格.*才.*多人团/);assert.match(text,/不作为备选凑数/);}
});
