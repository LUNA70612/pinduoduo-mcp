'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {perform}=require('../clis/pdd/_adapter.cjs');
test('selection failure reports its cause and clears every previously verified SKU price',async()=>{
 let reads=0;
 const page={evaluate:async js=>{
  if(js==='location.href')return 'https://mobile.yangkeduo.com/goods.html?goods_id=123';
  if(js==='performance.timeOrigin')return 1;
  if(js.startsWith('({ready:'))return{ready:'complete',loading:false};
  if(js.includes('"detail"'))return{status:'ok',goods_id:'123',title:'耳机',price:'¥10'};
  if(js.includes('"selection"'))return{selected:{颜色:'白',型号:'标准'}};
  if(js.includes('"spec_click"')){assert.ok(js.includes('"goods_id":"123"'));return{selected:false,diagnostic:'spec_dialog_product_unconfirmed'};}
  reads++;return{status:'unsupported',dialog_open:true,spec_groups:[{label:'颜色',options:['白','黑']},{label:'型号',options:['标准']}],skus:[{specs:{颜色:'白',型号:'标准'},price:'10',variant_price_verified:true}]};
 }};
 const r=await perform('read_sku',page,{goods_id:'123',spec_selection:{颜色:'黑',型号:'标准'},budget_max:200},{settle:false,entryStore:{matches:()=>true}});
 assert.equal(r.diagnostic,'spec_dialog_product_unconfirmed');assert.equal(r.selection_status,'price_unconfirmed');assert.ok(r.skus.every(s=>!s.variant_price_verified&&s.price_assessment.reference_price===null));
});
test('requested combination is revalidated after opening and stale groups are never clicked',async()=>{
 let opened=false,clicks=0;
 const page={evaluate:async js=>{
  if(js==='location.href')return 'https://mobile.yangkeduo.com/goods.html?goods_id=123';
  if(js==='performance.timeOrigin')return 1;
  if(js.startsWith('({ready:'))return{ready:'complete',loading:false};
  if(js.includes('"detail"'))return{status:'ok',goods_id:'123',title:'耳机',price:'¥10'};
  if(js.includes('"spec_open"')){opened=true;return{opened:true};}
  if(js.includes('"spec_click"')){clicks++;return{selected:true};}
  if(js.includes('"selection"'))return{selected:{}};
  return{status:'unsupported',dialog_open:opened,spec_groups:opened?[{label:'新组',options:['新值']}]:[{label:'颜色',options:['黑']}],skus:[]};
 }};
 const r=await perform('read_sku',page,{goods_id:'123',spec_selection:{颜色:'黑'}},{settle:false,entryStore:{matches:()=>true}});
 assert.equal(clicks,0);assert.equal(r.diagnostic,'incomplete_spec_selection');
});
