'use strict';
// Rebuild derived release evidence without editing historical calls or approving them.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ROOT}=require('../tools/config.cjs');
const {normalize,reviewDigest,inspectEvidence}=require('../tools/release-evidence.cjs');
const DIRECTORY='docs/dev/closing-release-2026-11-04';
const SNAPSHOT='docs/dev/compatibility-recovery-2026-11-04';
const INDEX=SNAPSHOT+'/EVIDENCE-INDEX.json';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function prepare(root=ROOT){
 const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8').replace(/^\uFEFF/,''));
 const save=(file,data)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),typeof data==='string'?data:JSON.stringify(data,null,2)+'\n');};
 const index=read(INDEX),rowMap=new Map(index.rows.map(r=>[r.original_evidence,r]));
 const reference=(address,page=true)=>{
  const [file,fragment]=address.split('#'),bytes=fs.readFileSync(path.join(root,file));
  const ref={file,sha256:sha(bytes),...(fragment?{pointer:'/'+fragment.replace(/^\//,'')}:{})};
  if(page){const known=rowMap.get(address)?.page_evidence?.file,guess=file.replace(/\.json$/,'-page.json');const target=known||(!fragment&&fs.existsSync(path.join(root,guess))?guess:null);if(target)ref.page=reference(target,false);}
  return ref;
 };
 function value(ref){const parent=read(ref.file);return ref.pointer?parent.records[Number(ref.pointer.split('/').at(-1))]:parent;}
 function segment(address){
  const search=reference(address),start=Number(search.pointer?.split('/').at(-1)??path.posix.basename(search.file).match(/^(\d+)\.json$/)?.[1]);
  let addresses;
  if(search.pointer){const parent=read(search.file);addresses=parent.records.map((r,i)=>({address:search.file+'#records/'+i,order:i,raw:r}));}
  else addresses=fs.readdirSync(path.join(root,path.posix.dirname(search.file))).filter(n=>/^\d+\.json$/.test(n)).map(n=>({address:path.posix.join(path.posix.dirname(search.file),n),order:Number(n.slice(0,-5)),raw:read(path.posix.join(path.posix.dirname(search.file),n))}));
  addresses.sort((a,b)=>a.order-b.order);const next=addresses.find(r=>r.order>start&&normalize(r.raw).name==='pdd_search')?.order??Infinity;
  return{search,records:addresses.filter(r=>r.order>=start&&r.order<next&&['pdd_search','pdd_read_item','pdd_read_sku'].includes(normalize(r.raw).name)).map(r=>reference(r.address))};
 }
 const snapshot=read(SNAPSHOT+'/LOCAL-VALIDATION-622d571.json');
 const manifest={schema_version:2,generated_at:new Date().toISOString(),runtime:{code_commit:'622d571',reader_sha256:snapshot.reader_sha256},categories:{},non_default:[],recommendations:{},validation:{},manual_review_file:DIRECTORY+'/MANUAL-REVIEW.json',impact_analysis:reference(DIRECTORY+'/IMPACT-ANALYSIS.md',false)};
 for(const category of Object.keys(require('../tools/category-acceptance.cjs').categories)){
  const fresh={clothing:'docs/dev/final-rounds/closing-clothing-20261104-r1/1.json',kitchen:'docs/dev/final-rounds/closing-kitchen-20261104-r1/0.json'}[category];
  if(fresh){if(fs.existsSync(path.join(root,fresh)))manifest.categories[category]={classification:'current_version_live',...segment(fresh)};continue;}
  const candidates=index.batches.filter(b=>b.category===category).flatMap(b=>b.segments).filter(s=>s.quantity_evidence).sort((a,b)=>Number(b.uninterrupted_success)-Number(a.uninterrupted_success));
  if(candidates.length)manifest.categories[category]={classification:'historical_applicable',...segment(candidates[0].search)};
 }
 // Only reference observed successes. Distinct product counting is performed again by the gate.
 for(const row of index.rows.filter(r=>r.non_default_verified)){
  const before=index.rows.filter(r=>r.goods_id===row.goods_id&&r.tool==='pdd_read_sku'&&r.status==='ok'&&r.verified_variants?.length&&path.posix.dirname(r.original_evidence)===path.posix.dirname(row.original_evidence)&&Date.parse(r.observed_at)<Date.parse(row.observed_at));
  const base=before.at(-1);if(base)manifest.non_default.push({base:reference(base.original_evidence),selected:reference(row.original_evidence)});
 }
 for(const category of ['cat_food','earphones']){
  const relevant=index.rows.filter(r=>r.category===category&&r.original_evidence.startsWith('docs/dev/final-rounds/')&&['pdd_read_item','pdd_read_sku'].includes(r.tool));
  const label=category==='cat_food'?'CAT-FOOD':'EARPHONES',original='docs/dev/final-rounds/'+label+'-COMPARISON.json',comparison=read(original);
  comparison.original_source=reference(original,false);
  comparison.gui_recovery=reference(SNAPSHOT+'/GUI-RECOVERY.json',false);
  comparison.limitations=(comparison.limitations||[]).filter(s=>!s.includes('GUI新参数实际重启后发现尚待'));
  for(const c of comparison.candidates){
   c.url='https://mobile.yangkeduo.com/goods.html?goods_id='+c.goods_id;
   c.evidence=(c.evidence||[]).map(p=>p.startsWith('docs/')?p:'docs/dev/final-rounds/'+p);
   if(!c.observed_at){const last=relevant.filter(r=>r.goods_id===c.goods_id&&r.status==='ok').at(-1);if(last)c.observed_at=last.observed_at;}
  }
  save(DIRECTORY+'/'+label+'-COMPARISON.json',comparison);
  manifest.recommendations[category]={comparison:reference(DIRECTORY+'/'+label+'-COMPARISON.json',false),records:relevant.filter(r=>r.status==='ok').map(r=>reference(r.original_evidence)),retained_failures:relevant.filter(r=>r.status!=='ok').map(r=>reference(r.original_evidence))};
 }
 for(const [kind,file] of Object.entries({local:'LOCAL-VALIDATION-622d571.json',sdk:'SDK-FIRST-ITEM-FIX.json',install:'INSTALL-GUI-FIX.json',gui:'GUI-RECOVERY.json'}))manifest.validation[kind]=reference(kind==='local'&&fs.existsSync(path.join(root,DIRECTORY+'/LOCAL-VALIDATION.json'))?DIRECTORY+'/LOCAL-VALIDATION.json':SNAPSHOT+'/'+file,false);
 const digest=reviewDigest(manifest),reviewFile=path.join(root,manifest.manual_review_file);
 let review;try{review=read(manifest.manual_review_file);}catch{}
 if(review?.status!=='passed')save(manifest.manual_review_file,{schema_version:1,status:'pending',reviewer:null,confirmation_source:null,reviewed_at:null,evidence_digest:digest,instructions:'请先核对 MANUAL-CHECKLIST.md；仅在用户明确确认此摘要对应证据后记录人工通过。原始调用中的 pending 保持原样。'});
 save('docs/dev/recommendation/release-gate.json',manifest);
 const report=inspectEvidence(root,manifest);save(DIRECTORY+'/RELEASE-CHECK.json',report);
 const names={cat_food:'猫粮',earphones:'耳机',clothing:'服装',shoes:'鞋',bedding:'家纺',household:'日化',kitchen:'厨具',appliances:'小家电',accessories:'数码配件',food:'食品'};
 const link=file=>path.posix.relative(DIRECTORY,file);
 const lines=['# 用户人工核对单','','此文件是待核对结果，代理核对不代签。以下均为当时的页面事实；价格时效、优惠资格、运费及商品实测质量另行保留未知。','','shipping_fee 表示运费未知，offer_eligibility 表示优惠资格未知。服装与厨具为本轮新批；其余八类按变更影响分析继承，保留原时间与版本。','','证据摘要：`'+digest+'`','','## 十品类读取',''];
 const summaries={};
 for(const [category,item] of Object.entries(manifest.categories)){
  const records=item.records.map(r=>({...normalize(value(r),read(r.file)),evidence:r})),details=records.filter(r=>r.name==='pdd_read_item'&&r.actual.status==='ok');
  const specs=records.filter(r=>r.name==='pdd_read_sku'&&r.actual.status==='ok').flatMap(r=>(r.actual.skus||[]).filter(v=>v.variant_price_verified).map(v=>({goods_id:r.actual.goods_id,specs:v.specs,price_assessment:v.price_assessment,sku_id:v.sku_id,observed_at:r.finish,evidence:r.evidence})));
  summaries[category]={category,classification:item.classification,search:item.search,goods:[...new Set(details.map(r=>r.actual.goods_id))],specifications:specs,manual_page_crosscheck:'pending',business_accepted:false,records:item.records};
  lines.push('### '+names[category]+'（'+(item.classification==='current_version_live'?'本轮新批':'历史证据继承')+'）','', '| 商品ID | 页面标题 | 详情显示价 | 读取时间 | 原始证据 |','|---|---|---|---|---|');
  for(const d of details)lines.push(`| ${d.actual.goods_id} | ${String(d.actual.title).replaceAll('|','/')} | ${d.actual.price} | ${d.finish||d.actual.fetched_at||'见原记录'} | [调用](${link(d.evidence.file)})${d.evidence.page?' / [页面]('+link(d.evidence.page.file)+')':''} |`);
  lines.push('');
  for(const s of specs)lines.push('- 完整组合：'+s.goods_id+'；`'+JSON.stringify(s.specs)+'`；参考价 '+s.price_assessment?.reference_price+' 元；条件 '+JSON.stringify(s.price_assessment?.conditions||[])+'；未知 '+JSON.stringify(s.price_assessment?.unknowns||[])+'；[调用]('+link(s.evidence.file)+')'+(s.evidence.page?' / [页面]('+link(s.evidence.page.file)+')':'')+'。');
  lines.push('');
 }
 lines.push('## 非默认组合','','以下默认/非默认记录保留原商品、版本和页面证据；不以不同商品结果替代旧失败。','');
 for(const pair of manifest.non_default){const b=normalize(value(pair.base)),s=normalize(value(pair.selected));lines.push('- '+s.actual.goods_id+'：默认 `'+JSON.stringify(b.actual.skus?.find(v=>v.variant_price_verified)?.specs)+'` → 指定 `'+JSON.stringify(s.input.spec_selection)+'`；[原始调用]('+link(pair.selected.file)+')'+(pair.selected.page?' / [页面]('+link(pair.selected.page.file)+')':'')+'。');}
 lines.push('','## 两类比较','','两份比较各有至少三个商品的规格读取证据，最终保留两款有条件候选；排除和失败记录不计为推荐成功。');
 for(const category of ['cat_food','earphones']){
  const comparison=value(manifest.recommendations[category].comparison);
  lines.push('','### '+names[category],'',comparison.scenario,'');
  for(const c of comparison.candidates){
   lines.push('- ['+c.name+'](https://mobile.yangkeduo.com/goods.html?goods_id='+c.goods_id+')；`'+JSON.stringify(c.specs)+'`；参考价 '+c.price_assessment.reference_price+' 元；条件 '+JSON.stringify(c.price_assessment.conditions)+'；读取时间 '+c.observed_at+'；未知 '+JSON.stringify(c.unknowns)+'。');
   if(c.reason)lines.push('','比较理由：'+c.reason+'。');
   if(c.unit_price_client_calculation)lines.push('','可比差异：明确包装口径下约 '+c.unit_price_client_calculation.value+' 元/'+c.unit_price_client_calculation.per+'，计算 '+c.unit_price_client_calculation.formula+'；'+c.unit_price_client_calculation.basis+'。');
   if(c.battery_claim)lines.push('','商家续航声明：'+c.battery_claim+'。');
   if(c.claims?.length)lines.push('','商家声明：'+c.claims.join('；')+'。');
   if(c.audio_claims?.length)lines.push('','商家功能声明：'+c.audio_claims.join('；')+'。');
   lines.push('','来源：'+(c.evidence||[]).map((file,i)=>'[证据'+(i+1)+']('+link(file)+')').join('、')+'。','');
  }
 }
 lines.push('','## 确认范围','','请集中核对商品对应、完整规格、参考价和条件是否与保存页面证据一致，以及比较理由是否忠于来源。确认不表示承诺商品质量、当前库存或最终到手价。','','人工状态仍为 pending。确认关联上方证据摘要；证据变化后原确认不再生效。','');
 save(DIRECTORY+'/MANUAL-CHECKLIST.md',lines.join('\n'));
 save(DIRECTORY+'/ACCEPTANCE-SUMMARY.json',{generated_at:manifest.generated_at,review_digest:digest,categories:summaries,non_default_references:manifest.non_default,recommendations:manifest.recommendations,automated_passed:report.automated_passed,manual_review:report.manual_review,release_allowed:report.release_allowed});
 return report;
}
if(require.main===module){try{const r=prepare();console.log(JSON.stringify({automated_passed:r.automated_passed,categories_passed:r.categories_passed,non_default_goods:r.non_default_goods,recommendations_passed:r.recommendations_passed,blockers:r.blockers},null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={prepare};
