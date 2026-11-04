'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {inspectEvidence,reviewDigest}=require('../tools/release-evidence.cjs');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

function fixture(t){
 const work=path.resolve(__dirname,'../work');fs.mkdirSync(work,{recursive:true});
 const root=fs.mkdtempSync(path.join(work,'release-evidence-test-'));
 t.after(()=>{assert.equal(path.dirname(root),work);fs.rmSync(root,{recursive:true,force:true});});
 const write=(file,value)=>{const bytes=JSON.stringify(value);fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),bytes);return{file,sha256:sha(bytes)};};
 const at='2026-11-04T01:00:00.000Z',later='2026-11-04T01:10:00.000Z';
 const manifest={schema_version:2,runtime:{reader_sha256:'a'.repeat(64)},categories:{},non_default:[],recommendations:{},validation:{},manual_review_file:'docs/dev/review.json'};
 manifest.impact_analysis=write('docs/dev/impact.md',{scope:'release only; existing reader unchanged'});
 function record(category,index,name,input,actual,extra={}){
  const proof=name==='pdd_search'?{path:'/search_result.html',query:input.query,search_cards:actual.results.map(r=>({...r,price:'¥10'}))}:name==='pdd_read_item'?{goods_id:actual.goods_id,title:'商品',detail_prices:['¥10']}: {goods_id:actual.goods_id,dialog_count:1,selected:actual.skus[0].specs,panel_prices:['¥10'],bound:{goods_id:actual.goods_id,selected_sku_id:actual.skus[0].sku_id}};
  const ref=write(`docs/dev/${category}/${index}.json`,{name,input,actual,start:index===0?at:later,finish:index===0?at:later,source_commit:'abc1234',reader_sha256:'a'.repeat(64),...extra});
  ref.page=write(`docs/dev/${category}/${index}-page.json`,proof);return ref;
 }
 function group(category,n){
  const ids=[1,2,3].map(i=>String(n*100+i)),records=[];
  records.push(record(category,0,'pdd_search',{query:category,exclude_group_purchase:true},{status:'ok',results:ids.map(goods_id=>({goods_id,title:'商品',price:'¥10'}))}));
  ids.forEach((goods_id,i)=>records.push(record(category,i+1,'pdd_read_item',{entry:'search',url:`https://mobile.yangkeduo.com/goods.html?goods_id=${goods_id}`},{status:'ok',goods_id,title:'商品',price:'¥10'})));
  const sku=(goods_id,color)=>({status:'ok',goods_id,spec_groups:[{label:'颜色',options:['白','黑']}],skus:[{sku_id:goods_id+'9',specs:{颜色:color},variant_price_verified:true,price:'10',price_assessment:{reference_price:10,conditions:[],unknowns:['shipping_fee']}}]});
  ids.forEach((goods_id,i)=>records.push(record(category,i+4,'pdd_read_sku',{goods_id},sku(goods_id,'白'))));
  const alternate=record(category,7,'pdd_read_sku',{goods_id:ids[0],spec_selection:{颜色:'黑'}},sku(ids[0],'黑'));
  records.push(alternate);
  manifest.categories[category]={classification:'current_version_live',search:records[0],records};
  manifest.non_default.push({base:records[4],selected:alternate});
  return{ids,records};
 }
 const groups={};Object.keys(require('../tools/category-acceptance.cjs').categories).forEach((category,i)=>groups[category]=group(category,i+1));
 for(const category of ['cat_food','earphones']){
  const {ids,records}=groups[category];
  const comparison=write(`docs/dev/${category}-comparison.json`,{comparison_complete:true,candidates:ids.slice(0,2).map(goods_id=>({goods_id,specs:{颜色:'白'},price_assessment:{reference_price:10,conditions:[],unknowns:['shipping_fee']}}))});
  manifest.recommendations[category]={comparison,records};
 }
 manifest.validation.local=write('docs/dev/local.json',{tests_passed:225,tests_failed:0,smoke:'passed'});
 manifest.validation.sdk=write('docs/dev/sdk.json',{results:[0,1].map(run=>({run,tool_count:10,prompt_count:3,schemas:'validated_by_sdk',ping:'passed'}))});
 manifest.validation.install=write('docs/dev/install.json',{exit_code:0,source_files_matched:true,adapters:9,tools:10,prompts:3,config:{cdp:'http://127.0.0.1:9335',writes_enabled:'0',absolute_server_path:true,profile_created:false},private_source_directories_excluded:true});
 manifest.validation.gui=write('docs/dev/gui.json',{gui_restart:'verified_current_gui_after_restart',last_sku_verified:true,browser_connected:true,writes_enabled:false});
 const approve=()=>write(manifest.manual_review_file,{status:'passed',reviewer:'user',confirmation_source:'user_confirmation',reviewed_at:later,evidence_digest:reviewDigest(manifest)});
 return{root,manifest,write,approve,groups};
}

test('complete referenced evidence is automatic-only until a separate user review matches its digest',t=>{
 const f=fixture(t),r=inspectEvidence(f.root,f.manifest);
 assert.equal(r.automated_passed,true,JSON.stringify(r.blockers));assert.equal(r.release_allowed,false);
 assert.deepEqual([...new Set(r.blockers.map(b=>b.code))],['manual_review_pending']);
 f.approve();assert.equal(inspectEvidence(f.root,f.manifest).release_allowed,true);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,f.groups.clothing.records[1].file))).manual_page_crosscheck,undefined);
});

test('gate reports all missing categories and recommendations in one result',()=>{
 const r=inspectEvidence(__dirname,{schema_version:2,categories:{},recommendations:{},validation:{},non_default:[]});
 assert.equal(r.release_allowed,false);assert.equal(r.categories_passed,0);
 assert.equal(r.blockers.filter(b=>b.code==='category_missing').length,10);
 assert.equal(r.blockers.filter(b=>b.code==='recommendation_missing').length,2);
});

test('category records cannot be stitched across batches or counted twice',t=>{
 const f=fixture(t),c=f.manifest.categories.clothing;
 c.records[2]=f.groups.kitchen.records[2];c.records[3]=c.records[1];
 const r=inspectEvidence(f.root,f.manifest);
 assert.ok(r.blockers.some(b=>b.code==='cross_batch_records'&&b.scope==='clothing'));
 assert.ok(r.blockers.some(b=>b.code==='category_details_incomplete'&&b.scope==='clothing'));
});

test('unverified prices, altered files and stale review approvals are rejected',t=>{
 const f=fixture(t);f.approve();
 const ref=f.groups.clothing.records[4],file=path.join(f.root,ref.file),d=JSON.parse(fs.readFileSync(file));
 d.actual.skus[0].variant_price_verified=false;fs.writeFileSync(file,JSON.stringify(d));
 let r=inspectEvidence(f.root,f.manifest);assert.ok(r.blockers.some(b=>b.code==='evidence_hash_mismatch'));
 ref.sha256=sha(fs.readFileSync(file));
 // Remove every other SKU from this category so a failed one cannot be masked.
 f.manifest.categories.clothing.records=f.manifest.categories.clothing.records.slice(0,5);
 r=inspectEvidence(f.root,f.manifest);
 assert.ok(r.blockers.some(b=>b.code==='category_sku_incomplete'));
 assert.ok(r.blockers.some(b=>b.code==='manual_review_digest_mismatch'));
});

test('historical evidence requires impact analysis and retains original versions',t=>{
 const f=fixture(t);f.manifest.categories.clothing.classification='historical_applicable';delete f.manifest.impact_analysis;
 assert.ok(inspectEvidence(f.root,f.manifest).blockers.some(b=>b.code==='impact_analysis_missing'));
});

test('references outside the evidence tree cannot be released',t=>{
 const f=fixture(t);f.manifest.categories.clothing.search={file:'../private.json',sha256:'a'.repeat(64)};
 assert.ok(inspectEvidence(f.root,f.manifest).blockers.some(b=>b.code==='invalid_evidence_path'));
});

test('non-default evidence counts distinct products with genuinely changed complete specifications',t=>{
 const f=fixture(t);f.manifest.non_default=[f.manifest.non_default[0],f.manifest.non_default[0],{base:f.manifest.non_default[1].base,selected:f.manifest.non_default[1].base}];
 const r=inspectEvidence(f.root,f.manifest);assert.equal(r.non_default_goods,1);
 assert.ok(r.blockers.some(b=>b.code==='non_default_incomplete'));
});

test('a later search in the same directory cannot reuse earlier context',t=>{
 const f=fixture(t),c=f.manifest.categories.clothing;
 const ref=f.write('docs/dev/clothing/2.json',{name:'pdd_search',input:{query:'another'},actual:{status:'ok',results:[]},start:'2026-11-04T01:05:00.000Z'});
 c.records[2]={...ref,page:c.records[2].page};
 const r=inspectEvidence(f.root,f.manifest);assert.ok(r.blockers.some(b=>b.code==='multiple_search_segments'));
});

test('public release gate uses referenced evidence and reports every missing gate without creating output',t=>{
 const f=fixture(t),gate=require('../tools/release-gate.cjs');
 const missing=gate.inspectReleaseGate(f.root);
 assert.equal(missing.blockers.filter(b=>b.code==='category_missing').length,10);
 f.write('docs/dev/recommendation/release-gate.json',f.manifest);
 assert.throws(()=>gate.verifyReleaseGate(f.root),/人工/);
 assert.equal(fs.existsSync(path.join(f.root,'outputs')),false);
 f.approve();assert.equal(gate.verifyReleaseGate(f.root).release_allowed,true);
});

test('complete specification evidence must match both the requested product and every real group',t=>{
 for(const mode of ['wrong_product','missing_group']){
  const f=fixture(t),c=f.manifest.categories.clothing;
  for(const ref of c.records.slice(4)){
   const raw=JSON.parse(fs.readFileSync(path.join(f.root,ref.file)));
   if(mode==='wrong_product')raw.input.goods_id='999999';
   else raw.actual.spec_groups.push({label:'版本',options:['旗舰']});
   const updated=f.write(ref.file,raw);ref.sha256=updated.sha256;
  }
  assert.ok(inspectEvidence(f.root,f.manifest).blockers.some(b=>b.code==='category_sku_incomplete'&&b.scope==='clothing'),mode);
 }
});
