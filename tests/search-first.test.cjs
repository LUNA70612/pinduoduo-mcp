'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const comparison=require('../clis/pdd/_comparison.cjs');
const {inspectPage}=require('../clis/pdd/_dom.cjs');
function catalog(html){const {document}=parseHTML(`<html><body>${html}</body></html>`);return inspectPage(document,new URL('https://mobile.yangkeduo.com/search_result.html?search_key=猫粮'),'catalog');}
test('unverified detail price cannot be promoted to a reference specification price',()=>{
 const r=comparison.withComparison({status:'ok',price:'¥10',variant_price_verified:false},{budget_max:200});
 assert.equal(r.price_assessment?.reference_price,null);
 assert.equal(r.price_assessment?.budget_status,'unknown');
});
test('verified group price remains conditional and never includes unknown freight',()=>{
 const r=comparison.withComparison({status:'ok',skus:[{specs:{重量:'1kg'},price:'100',price_basis:'loaded_sku_group_price',requires_group_purchase:true,variant_price_verified:true,offer_eligibility_verified:false}]},{budget_max:200});
 const p=r.skus[0].price_assessment;assert.equal(p?.reference_price,100);assert.equal(p?.basis,'group_purchase');assert.equal(p?.budget_status,'conditional_within_budget');assert.ok(p?.unknowns.includes('shipping_fee'));assert.ok(p?.conditions.includes('group_purchase_required'));assert.equal(r.price_assessment.reference_price,null);
});
test('regular price over budget is rejected even when freight is unknown',()=>{
 const r=comparison.withComparison({status:'ok',skus:[{specs:{颜色:'白'},price:'200.01',price_basis:'selected_sku_display',variant_price_verified:true}]},{budget_max:200});
 assert.equal(r.skus[0].price_assessment?.budget_status,'over_budget');
});
test('visible no-results notice with recommended cards is not a normal matching search',()=>{
 const r=catalog('<div role="status">没有找到相关商品，为你推荐</div><a href="/goods.html?goods_id=123"><h3>推荐猫粮</h3><span class="price">¥10</span></a>');
 assert.equal(r.search_context?.result_kind,'recommendations_after_no_results');assert.equal(r.search_context?.query_match_verified,false);
});
test('hidden empty labels never mark an unfinished catalog as empty',()=>{
 assert.equal(catalog('<div hidden>暂无相关商品</div><div aria-busy="true">正在加载</div>').status,'unsupported');
});
test('budget argument is validated and discoverable for both detail and sku',()=>{
 const {normalize}=require('../clis/pdd/_shared.cjs');for(const kind of ['detail','read_sku'])assert.throws(()=>normalize(kind,{goods_id:'123',budget_max:-1}),e=>e.code==='INVALID_ARGUMENT');
 for(const name of ['pdd_read_item','pdd_read_sku'])assert.equal(require('../tools/pdd.cjs').tools.find(t=>t.name===name).inputSchema.properties.budget_max?.type,'number');
});
test('incomplete spec request does not open an otherwise safe dialog',async()=>{
 const {perform}=require('../clis/pdd/_adapter.cjs');let opened=0;
 const page={evaluate:async js=>{if(js==='location.href')return'https://mobile.yangkeduo.com/goods.html?goods_id=123';if(js.includes('"spec_open"')){opened++;return{opened:true};}if(js.includes('"detail"'))return{status:'ok',goods_id:'123',title:'耳机',price:'¥10'};return{status:'unsupported',diagnostic:'selected_price_unverified',spec_groups:[{label:'颜色',options:['白','黑']},{label:'型号',options:['标准']}],skus:[]};}};
 const r=await perform('read_sku',page,{goods_id:'123',spec_selection:{颜色:'黑'}},{settle:false,entryStore:{matches:()=>true}});assert.equal(opened,0);assert.equal(r.diagnostic,'incomplete_spec_selection');
});
test('loading specification price cannot be verified even after selected text changed',()=>{
 const fs=require('node:fs'),path=require('node:path');const f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/pdd-sku-dialog-2026-11-03.json'),'utf8'));
 const {document}=parseHTML(`<html><body>${f.html}</body></html>`);document.querySelector('[role="dialog"]').setAttribute('aria-busy','true');
 const r=inspectPage(document,new URL(`https://mobile.yangkeduo.com/goods.html?goods_id=${f.goods_id}`),'sku',{goods_id:f.goods_id});assert.equal(r.status,'unsupported');assert.equal(r.diagnostic,'sku_price_loading');assert.ok(!r.skus.some(s=>s.variant_price_verified));
});
test('selection polling waits for matching stable specification prices without clicking',async()=>{
 const {waitForSelectedSku}=require('../clis/pdd/_adapter.cjs');assert.equal(typeof waitForSelectedSku,'function');let time=0,reads=0;
 const r=await waitForSelectedSku(null,{spec_selection:{颜色:'黑'}},{now:()=>time,pause:async ms=>{time+=ms;},read:async()=>{reads++;return reads<3?{status:'unsupported',skus:[]}:{status:'ok',skus:[{specs:{颜色:'黑'},price:'25',variant_price_verified:true}]};}});
 assert.equal(r.skus[0].price,'25');assert.ok(reads>=4);
});
test('selection polling demotes unconfirmed price on timeout rather than reusing old evidence',async()=>{
 const {waitForSelectedSku}=require('../clis/pdd/_adapter.cjs');let time=0;
 const r=await waitForSelectedSku(null,{spec_selection:{颜色:'黑'}},{timeout:1000,now:()=>time,pause:async ms=>{time+=ms;},read:async()=>({status:'ok',skus:[{specs:{颜色:'白'},price:'10',variant_price_verified:true}]})});
 assert.equal(r.status,'unsupported');assert.equal(r.skus[0].variant_price_verified,false);assert.equal(r.selection_status,'price_unconfirmed');assert.ok(r.missing_evidence.includes('specification_price'));
});
test('selection wait tolerates the page updating after a visible option click',async()=>{
 const {waitForSelection}=require('../clis/pdd/_adapter.cjs');let time=0,reads=0;
 const r=await waitForSelection(null,{spec_selection:{颜色:'白',尺码:'42'}},{now:()=>time,pause:async ms=>{time+=ms;},read:async()=>{reads++;return reads<3?{status:'ok',selected:{颜色:'黑',尺码:'41'}}:{status:'ok',selected:{颜色:'白',尺码:'42'}};}});
 assert.deepEqual(r.selected,{颜色:'白',尺码:'42'});assert.equal(reads,3);
});

test('selection polling preserves an unchanged selection and never manufactures a match',async()=>{
 const {waitForSelection}=require('../clis/pdd/_adapter.cjs');let time=0,reads=0;
 const r=await waitForSelection(null,{goods_id:'123',spec_selection:{尺码:'43'}},{timeout:500,now:()=>time,pause:async ms=>{time+=ms;},read:async()=>{reads++;return{status:'ok',selected:{尺码:'41'},sku_id:'old',price_nodes:['¥13.7']};}});
 assert.equal(reads,3);assert.equal(r.selected.尺码,'41');assert.equal(r.diagnostic,'selected_specs_mismatch');assert.equal(r.sku_id,'old');
});

test('selection polling stops immediately on changed product identity',async()=>{
 const {waitForSelection}=require('../clis/pdd/_adapter.cjs');let reads=0;
 const r=await waitForSelection(null,{goods_id:'123',spec_selection:{尺码:'43'}},{read:async()=>{reads++;return{status:'target_mismatch',goods_id:'456',selected:{尺码:'43'}};},pause:async()=>assert.fail('identity change must not wait')});
 assert.equal(reads,1);assert.equal(r.status,'target_mismatch');
});

test('a selected specification with continuously changing prices cannot be verified',async()=>{
 const {waitForSelectedSku}=require('../clis/pdd/_adapter.cjs');let time=0,reads=0;
 const r=await waitForSelectedSku(null,{goods_id:'123',spec_selection:{尺码:'43'}},{timeout:1000,now:()=>time,pause:async ms=>{time+=ms;},read:async()=>({status:'ok',skus:[{specs:{尺码:'43'},sku_id:'sku43',price:String(10+(reads++%2)),variant_price_verified:true}]})});
 assert.equal(r.status,'unsupported');assert.equal(r.diagnostic,'selected_price_update_unconfirmed');assert.ok(r.skus.every(s=>s.variant_price_verified===false));
});
