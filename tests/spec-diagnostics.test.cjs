'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {parseHTML}=require('linkedom'),{inspectPage}=require('../clis/pdd/_dom.cjs');
function loaded(change=()=>{}){
 const f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/pdd-loaded-sku-2026-11-03.json'),'utf8'));change(f);
 const {document}=parseHTML(`<html><body>${f.html}</body></html>`);document.querySelector('[role=dialog]').__reactFiber$test={return:{memoizedProps:{goods:f.goods},stateNode:{state:f.state}}};
 return inspectPage(document,new URL(`https://mobile.yangkeduo.com/goods.html?goods_id=${f.goods_id}`),'sku',{goods_id:f.goods_id});
}
test('verified, unselected, incomplete and unconfirmed selections have independent entry diagnostics',()=>{
 const verified=loaded();assert.equal(verified.selection_status,'verified');assert.equal(verified.safe_entry_status,'missing');assert.deepEqual(verified.missing_evidence,[]);assert.equal(verified._selection,undefined);
 const none=loaded(f=>{f.state.selectedSkuID=null;f.state.currentSelect={};f.html=f.html.replace(/hr353bdX/g,'');});assert.equal(none.selection_status,'not_selected');assert.ok(none.missing_evidence.includes('complete_selection'));assert.ok(none.missing_evidence.includes('safe_spec_entry'));
 const partial=loaded(f=>{f.html=f.html.replace('F7sZG3xe hr353bdX','F7sZG3xe');});assert.equal(partial.selection_status,'incomplete');
 const price=loaded(f=>{f.state.skuInfos['1988704811472'].groupPrice='99.99';});assert.equal(price.selection_status,'price_unconfirmed');assert.ok(price.missing_evidence.includes('specification_price'));
 const wrong=loaded(f=>{f.goods.goodsID='123';});assert.equal(wrong.selection_status,'unknown');assert.ok(wrong.missing_evidence.includes('product_identity'));
});
test('entry scan is read only, restricted to spec region and refuses duplicate safe entries',()=>{
 for(const [html,state]of [
 ['<button>选择规格</button>','missing'],
 ['<div data-spec-region><button>选择规格</button></div>','available'],
 ['<div data-spec-region><button>选择规格</button><button>规格选择</button></div>','ambiguous'],
 ['<div data-spec-region><button>立即购买</button></div>','missing'],
 ['<div class="xJDS9NLo">已选：黑色</div>','missing']]){
  const {document}=parseHTML(`<html><body>${html}</body></html>`);let clicks=0;for(const e of document.querySelectorAll('button'))e.addEventListener('click',()=>clicks++);
  const r=inspectPage(document,new URL('https://mobile.yangkeduo.com/goods.html?goods_id=123'),'spec_entry',{goods_id:'123'});assert.equal(r.safe_entry_status,state);assert.equal(clicks,0);
  if(state!=='available'){const opened=inspectPage(document,new URL('https://mobile.yangkeduo.com/goods.html?goods_id=123'),'spec_open',{goods_id:'123'});assert.equal(opened.opened,false);assert.equal(clicks,0);}
 }
});
test('new fields are discoverable and preserved by the evidence sanitizer',()=>{
 const r=loaded(),tool=require('../tools/pdd.cjs').tools.find(t=>t.name==='pdd_read_sku');
 for(const k of ['selection_status','safe_entry_status','missing_evidence','safe_entry_evidence']){assert.ok(tool.outputSchema.properties[k]);assert.deepEqual(require('../scripts/recommendation-acceptance.cjs').sanitize(r)[k],r[k]);}
});

test('entry evidence explains rejection without exposing hidden text or links',()=>{
 const f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/pdd-entry-hidden-2026-11-04.json'),'utf8'));
 const {document}=parseHTML(`<html><body>${f.html}<button>选择规格</button><div data-spec-region><span class="spec-entry">已选：黑色</span><button>立即购买</button></div></body></html>`);
 const r=inspectPage(document,new URL(`https://mobile.yangkeduo.com/goods.html?goods_id=${f.goods_id}`),'spec_entry',{goods_id:f.goods_id});
 assert.equal(r.safe_entry_status,'missing');const e=r.safe_entry_evidence;assert.equal(e.hidden_region_count,1);assert.equal(e.accepted_count,0);assert.ok(!JSON.stringify(e).includes('10斤大桶'));
 assert.ok(e.candidates.some(c=>c.reasons.includes('outside_spec_region')));assert.ok(e.candidates.some(c=>c.reasons.includes('click_behavior_unconfirmed')));assert.ok(e.candidates.some(c=>c.reasons.includes('unsafe_control')));
});

test('observed kitchen minimum price never verifies the different selected capacity',()=>{
 const f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/pdd-kitchen-price-conflict-2026-11-04.json'),'utf8'));
 const {document}=parseHTML(`<html><body>${f.html}</body></html>`);document.querySelector('[role=dialog]').__reactFiber$test={return:{memoizedProps:{goods:f.goods},stateNode:{state:f.state}}};
 const r=inspectPage(document,new URL(`https://mobile.yangkeduo.com/goods.html?goods_id=${f.goods_id}`),'sku',{goods_id:f.goods_id});
 assert.equal(r.status,'unsupported');assert.equal(r.selection_status,'price_unconfirmed');assert.equal(r.safe_entry_status,'missing');assert.equal(r.diagnostic,'selected_price_unverified');assert.equal(r.safe_entry_evidence.visible_region_count,0);
 const compared=require('../clis/pdd/_comparison.cjs').withComparison(r,{budget_max:200});assert.equal(compared.skus.length,2);for(const s of compared.skus){assert.equal(s.variant_price_verified,false);assert.equal(s.price_assessment.reference_price,null);assert.ok(s.price_assessment.conditions.includes('大促价'));}
});

test('visible selected SKU retains product and panel offer conditions without claiming final price',()=>{
 const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/pdd-sku-dialog-2026-11-03.json'),'utf8'));
 const {document}=parseHTML(`<html><body><span class="tLYIg_Ju enable-select">商品</span><span class="uPP2olgd">限1件¥21.89</span>${fixture.html}</body></html>`);
 const r=inspectPage(document,new URL(`https://mobile.yangkeduo.com/goods.html?goods_id=${fixture.goods_id}`),'sku',{goods_id:fixture.goods_id});assert.equal(r.selection_status,'verified');
 const sku=require('../clis/pdd/_comparison.cjs').withComparison(r,{budget_max:100}).skus[0];assert.ok(sku.offer_conditions.includes('限1件'));assert.equal(sku.price_assessment.budget_status,'conditional_within_budget');assert.equal(sku.price_assessment.total_price_confirmed,false);assert.ok(sku.price_assessment.unknowns.includes('shipping_fee'));
 document.querySelector('[role=dialog]').setAttribute('data-goods-id','999');const wrong=inspectPage(document,new URL(`https://mobile.yangkeduo.com/goods.html?goods_id=${fixture.goods_id}`),'sku',{goods_id:fixture.goods_id});assert.equal(wrong.selection_status,'unknown');
});

test('missing safe entry preserves original selection failure rather than replacing it',async()=>{
 const {perform}=require('../clis/pdd/_adapter.cjs');
 const page={evaluate:async js=>js==='location.href'?'https://mobile.yangkeduo.com/goods.html?goods_id=123':js==='performance.timeOrigin'?1:js.includes('"detail"')?{status:'ok',title:'商品',price:'¥10'}:js.includes('"spec_open"')?{opened:false,diagnostic:'safe_spec_entry_missing',safe_entry_status:'missing'}:{status:'unsupported',diagnostic:'selected_price_unverified',selection_status:'not_selected',safe_entry_status:'missing',missing_evidence:['complete_selection','specification_price','safe_spec_entry'],skus:[]}};
 const r=await perform('read_sku',page,{goods_id:'123'},{settle:false,entryStore:{matches:()=>true}});assert.equal(r.diagnostic,'selected_price_unverified');assert.equal(r.entry_diagnostic,'safe_spec_entry_missing');assert.equal(r.selection_status,'not_selected');
});
