'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createClient}=require('../tools/client-core.cjs');
test('normal search return tolerates platform-added tracking but never a different query or sort',()=>{
 const {sameSearch}=require('../clis/pdd/_adapter.cjs'),source='https://mobile.yangkeduo.com/search_result.html?search_key=%E6%B4%97%E8%A1%A3%E6%B6%B2';
 assert.equal(sameSearch(source+'&page_id=opaque&flip=opaque&item_index=1',source),true);
 for(const wrong of ['https://evil.test/search_result.html?search_key=洗衣液','https://mobile.yangkeduo.com/search_result.html?search_key=猫粮',source+'&sort=price',source+'&search_key=猫粮'])assert.equal(sameSearch(wrong,source),false);
});
test('expired search stops before browser, keeps 30 minute limit and explicit search renews context',async()=>{
 let clock=0,calls=0,context;
 const client=createClient({now:()=>clock,invoke:async(flags,c)=>{calls++;context=c;return{stdout:JSON.stringify({ok:true,data:flags[0]==='search'?{status:'ok',_search_context:{target_id:'tab1',document_id:123},results:[{goods_id:'123',_source_url:'https://mobile.yangkeduo.com/goods.html?goods_id=123',url:'https://mobile.yangkeduo.com/goods.html?goods_id=123'}]}:{status:'ok'}})};}});
 const search=await client.search({query:'耳机'});assert.equal(search._search_context,undefined);assert.equal(search.results[0]._source_url,undefined);
 await client.readItem({url:'123'});assert.equal(context.target_id,'tab1');assert.equal(context.document_id,123);
 clock=1800000;const before=calls;assert.equal((await client.readSku({goods_id:'123'})).diagnostic,'search_context_expired');assert.equal(calls,before);
 assert.equal(client.recoverySource('pdd_read_sku',{goods_id:'123'}).diagnostic,'search_context_expired');assert.equal(calls,before);
 assert.equal(client.recoverySource('pdd_read_item',{url:'999'}).diagnostic,'search_context_missing');assert.equal(calls,before);
 await client.search({query:'耳机'});assert.equal((await client.readSku({goods_id:'123'})).status,'ok');
 assert.equal(client.recoverySource('pdd_read_item',{url:'123'}).status,'ok');
});
test('verified return uses history once and clicks card, missing card never gets direct navigation fallback',async()=>{
 const {perform}=require('../clis/pdd/_adapter.cjs');const old=process.env.PDD_SOURCE_SEARCH_URL;
 const search='https://mobile.yangkeduo.com/search_result.html?search_key=test';
 try{
  process.env.PDD_SOURCE_SEARCH_URL=search;
  for(const found of [true,false]){
   let current='https://mobile.yangkeduo.com/goods.html?goods_id=111',backs=0,clicks=0;
   const page={goto:async()=>{throw Error('must use normal return');},evaluate:async js=>{
    if(js==='location.href')return current;if(js==='performance.timeOrigin')return 1;
    if(js==='history.back()'){backs++;current=search+'&page_id=opaque&flip=opaque';return;}
    if(js.startsWith('(() => {try{const r=JSON.parse(sessionStorage.getItem('))return true;
    if(js.includes('"product_open"')){clicks++;if(!found)return{status:'unsupported',diagnostic:'unique_search_card_missing',clicked:false};current='https://mobile.yangkeduo.com/goods.html?goods_id=222';return{clicked:true};}
    if(js.includes('sessionStorage'))return;
    return{status:'ok',goods_id:'222',title:'商品',price:'¥10'};
   }};
   const result=await perform('detail',page,{goods_id:'222'},{settle:false,entryStore:{matches:id=>id==='111',record(){}}});
   assert.equal(backs,1);assert.equal(clicks,1);assert.equal(result.status,found?'ok':'unsupported');
  }
 }finally{old===undefined?delete process.env.PDD_SOURCE_SEARCH_URL:process.env.PDD_SOURCE_SEARCH_URL=old;}
});
test('wrong history return stops without repeating back, goto or clicking',async()=>{
 const {perform}=require('../clis/pdd/_adapter.cjs');const old=process.env.PDD_SOURCE_SEARCH_URL;let backs=0;
 try{process.env.PDD_SOURCE_SEARCH_URL='https://mobile.yangkeduo.com/search_result.html?search_key=test';
 const page={goto:async()=>assert.fail('no goto'),evaluate:async js=>{if(js==='location.href')return'https://mobile.yangkeduo.com/goods.html?goods_id=111';if(js==='performance.timeOrigin')return 1;if(js==='history.back()'){backs++;return;}if(js.startsWith('(() => {try{const r=JSON.parse(sessionStorage.getItem('))return true;assert.fail('unexpected click');}};
 assert.equal((await perform('detail',page,{goods_id:'222'},{settle:false,entryStore:{matches:()=>true}})).diagnostic,'search_return_mismatch');assert.equal(backs,1);
 }finally{old===undefined?delete process.env.PDD_SOURCE_SEARCH_URL:process.env.PDD_SOURCE_SEARCH_URL=old;}
});

test('missing pinned tab never switches to another tab and wrong CDP identity cannot navigate',async()=>{
 const {operationEnv}=require('../tools/target-selection.cjs'),{perform}=require('../clis/pdd/_adapter.cjs');
 await assert.rejects(operationEnv('detail',{goods_id:'123',target_id:'missing'},{OPENCLI_CDP_ENDPOINT:'http://127.0.0.1:9335'},async()=>({ok:true,json:async()=>[{id:'other',type:'page',url:'https://mobile.yangkeduo.com/search_result.html',webSocketDebuggerUrl:'ws://local'}]})),e=>e.code==='BROWSER_TARGET_MISSING');
 const old=process.env.PDD_TARGET_ID;
 try{process.env.PDD_TARGET_ID='expected';const r=await perform('detail',{cdp:async()=>({targetInfo:{targetId:'other'}}),evaluate:async()=>assert.fail('no page access'),goto:async()=>assert.fail('no navigation')},{goods_id:'123'});assert.equal(r.diagnostic,'browser_target_mismatch');}
 finally{old===undefined?delete process.env.PDD_TARGET_ID:process.env.PDD_TARGET_ID=old;}
});
