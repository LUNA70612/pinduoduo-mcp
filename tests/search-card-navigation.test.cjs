'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{parseHTML}=require('linkedom');
const {inspectPage}=require('../clis/pdd/_dom.cjs'),{perform}=require('../clis/pdd/_adapter.cjs');
test('click receipt survives child restart but rejects a new document, different product or expiry',()=>{
 const fs=require('node:fs'),path=require('node:path'),{createEntryStore}=require('../clis/pdd/_product-entry.cjs');const base=path.resolve(__dirname,'../work');fs.mkdirSync(base,{recursive:true});const directory=fs.mkdtempSync(path.join(base,'pdd-entry-'));let time=100;
 try{createEntryStore({directory,now:()=>time}).record('123',12345);const store=createEntryStore({directory,now:()=>time});assert.equal(store.matches('123',12345),true);assert.equal(store.matches('999',12345),false);assert.equal(store.matches('123',12346),false);time+=1800001;assert.equal(store.matches('123',12345),false);}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('only a matching click receipt permits reuse of an already-open product',async()=>{
 const page={evaluate:async js=>js==='location.href'?'https://mobile.yangkeduo.com/goods.html?goods_id=123':js==='performance.timeOrigin'?456:{status:'ok',goods_id:'123',title:'耳机',price:'¥10'},goto:async()=>{throw Error('must reuse verified document');}};
 const r=await perform('detail',page,{goods_id:'123'},{settle:false,entryStore:{matches:(id,doc)=>id==='123'&&doc===456}});assert.equal(r.navigation_source,'existing_search_target');assert.equal(r.status,'ok');
});
test('auto and omitted entry cannot read an arbitrary already-open product or fall back to goto',async()=>{
 const old={entry:process.env.PDD_PRODUCT_ENTRY,source:process.env.PDD_SOURCE_URL,search:process.env.PDD_SOURCE_SEARCH_URL};
 const page={evaluate:async js=>js==='location.href'?'https://mobile.yangkeduo.com/goods.html?goods_id=123':12345,goto:async()=>{throw Error('direct product goto forbidden');}};
 try{delete process.env.PDD_SOURCE_URL;delete process.env.PDD_SOURCE_SEARCH_URL;for(const entry of [undefined,'auto']){entry===undefined?delete process.env.PDD_PRODUCT_ENTRY:process.env.PDD_PRODUCT_ENTRY=entry;for(const kind of ['detail','read_sku'])assert.equal((await perform(kind,page,{goods_id:'123'},{settle:false,entryStore:{matches:()=>false}})).diagnostic,'search_context_missing');}}finally{for(const[key,v]of Object.entries({PDD_PRODUCT_ENTRY:old.entry,PDD_SOURCE_URL:old.source,PDD_SOURCE_SEARCH_URL:old.search}))v===undefined?delete process.env[key]:process.env[key]=v;}
});
test('MCP requires same-connection search for detail auto, old omitted entry and SKU',async()=>{
 let invoked=0;const client=require('../tools/client-core.cjs').createClient({invoke:async()=>{invoked++;throw Error('must stop before browser');}});
 for(const entry of [undefined,'auto','search'])assert.equal((await client.readItem({url:'123',...(entry?{entry}:{})})).diagnostic,'search_context_missing');
 assert.equal((await client.readSku({goods_id:'123'})).diagnostic,'search_context_missing');assert.equal(invoked,0);
});
test('search product open clicks exactly one bound card image and never purchase controls',()=>{
 const {document}=parseHTML('<html><body><div class="_3glhOBhU" data-uniqid="1"><div class="LOFjVUas"><img></div></div><button>立即购买</button></body></html>');
 const card=document.querySelector('[data-uniqid]');card.__reactProps$test={children:{props:{goods:{goodsID:'123',linkURL:'/goods.html?goods_id=123',goodsName:'洗衣液'}}}};
 let clicked=0;card.querySelector('img').addEventListener('click',()=>clicked++);
 const r=inspectPage(document,new URL('https://mobile.yangkeduo.com/search_result.html?search_key=洗衣液'),'product_open',{goods_id:'123'});
 assert.equal(r.clicked,true);assert.equal(clicked,1);
 assert.deepEqual(r.click_target,{tag:'IMG',kind:'bound_card_image'});
 assert.equal(inspectPage(document,new URL('https://mobile.yangkeduo.com/search_result.html?search_key=洗衣液'),'product_open',{goods_id:'999'}).clicked,false);assert.equal(clicked,1);
});

test('entry diagnostics compare search provenance without exposing tracking or URL values',()=>{
 const {entryEvidence}=require('../clis/pdd/_adapter.cjs');
 const source='https://mobile.yangkeduo.com/search_result.html?search_key=洗衣液&page_id=private-page';
 const target='https://mobile.yangkeduo.com/goods.html?goods_id=123&_x_query=洗衣液&refer_page_id=private-page&uin=private-account';
 const e=entryEvidence(source,target,'123',{tag:'IMG',kind:'bound_card_image'});
 assert.equal(e.goods_id_matches,true);assert.equal(e.search_query_matches,true);assert.equal(e.source_page_matches,true);assert.equal(e.click_target_tag,'IMG');
 for(const forbidden of ['private-page','private-account','洗衣液','https://'])assert.equal(JSON.stringify(e).includes(forbidden),false);
 assert.equal(entryEvidence(source,target.replace('goods_id=123','goods_id=999'),'123').goods_id_matches,false);
 const bare=entryEvidence(source,'https://mobile.yangkeduo.com/goods.html?goods_id=123','123');assert.equal(bare.search_query_matches,null);assert.equal(bare.source_page_matches,null);
 assert.equal(entryEvidence(source,target+'&_x_query=别的','123').search_query_matches,null);
});
test('ambiguous or hidden cards cannot trigger a product click',()=>{
 const {document}=parseHTML('<html><body><div class="_3glhOBhU" data-uniqid="1"><div class="LOFjVUas"><img></div></div><div class="_3glhOBhU" data-uniqid="2"><div class="LOFjVUas"><img></div></div></body></html>');let clicks=0;
 for(const card of document.querySelectorAll('[data-uniqid]')){card.__reactProps$test={children:{props:{goods:{goodsID:'123',linkURL:'/goods.html?goods_id=123'}}}};card.querySelector('img').addEventListener('click',()=>clicks++);}
 assert.equal(inspectPage(document,new URL('https://mobile.yangkeduo.com/search_result.html'),'product_open',{goods_id:'123'}).clicked,false);assert.equal(clicks,0);
 for(const card of document.querySelectorAll('[data-uniqid]'))card.hidden=true;
 assert.equal(inspectPage(document,new URL('https://mobile.yangkeduo.com/search_result.html'),'product_open',{goods_id:'123'}).clicked,false);assert.equal(clicks,0);
 const anchor=document.createElement('a');anchor.setAttribute('data-goods-id','123');anchor.setAttribute('href','/goods.html?goods_id=999');anchor.addEventListener('click',()=>clicks++);document.body.appendChild(anchor);
 assert.equal(inspectPage(document,new URL('https://mobile.yangkeduo.com/search_result.html'),'product_open',{goods_id:'123'}).clicked,false);assert.equal(clicks,0);
});
test('explicit search entry uses actual card click instead of goto of incomplete bound link',async()=>{
 const old={entry:process.env.PDD_PRODUCT_ENTRY,source:process.env.PDD_SOURCE_URL,search:process.env.PDD_SOURCE_SEARCH_URL};
 const search='https://mobile.yangkeduo.com/search_result.html?search_key=洗衣液';let current=search,clicks=0;
 const page={url:async()=>current,goto:async()=>{throw Error('must not replace card click with goto');},evaluate:async js=>{if(js==='location.href')return current;if(js==='document.referrer')return search;if(js.includes('"product_open"')){clicks++;current='https://mobile.yangkeduo.com/goods.html?goods_id=123&refer_page_name=search';return{status:'ok',clicked:true};}return{status:'ok',goods_id:'123',title:'洗衣液',price:'¥9.5'};}};
 try{process.env.PDD_PRODUCT_ENTRY='search';process.env.PDD_SOURCE_URL='https://mobile.yangkeduo.com/goods.html?goods_id=123';process.env.PDD_SOURCE_SEARCH_URL=search;const r=await perform('detail',page,{goods_id:'123'},{settle:false});assert.equal(clicks,1);assert.equal(r.navigation_source,'search_card_click');assert.equal(r.status,'ok');}finally{for(const [key,v]of Object.entries({PDD_PRODUCT_ENTRY:old.entry,PDD_SOURCE_URL:old.source,PDD_SOURCE_SEARCH_URL:old.search}))v===undefined?delete process.env[key]:process.env[key]=v;}
});
