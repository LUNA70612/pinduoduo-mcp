'use strict';
// Release-only verification. Browser tasks and original evidence are never mutated.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const categoryNames=Object.keys(require('./category-acceptance.cjs').categories);
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const same=(a,b)=>!!a&&!!b&&Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([k,v])=>b[k]===v);
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));return value;}
function reviewDigest(manifest){const copy={...manifest};delete copy.generated_at;delete copy.manual_review_file;return sha(JSON.stringify(stable(copy)));}
function normalize(raw,parent={}){
 const nested=raw?.input?.name;
 return{name:nested||raw?.name||raw?.tool,input:nested?raw.input.arguments||{}:raw?.input||{},actual:raw?.actual||raw?.result||{},start:raw?.start||raw?.started_at,finish:raw?.finish||raw?.finished_at,source_commit:raw?.source_commit||parent.source_commit,reader_sha256:raw?.reader_sha256||parent.reader_sha256};
}
function inspectEvidence(root,manifest){
 const blockers=[],seen=new Set();
 const add=(code,scope,message)=>{const key=JSON.stringify([code,scope,message]);if(!seen.has(key)){seen.add(key);blockers.push({code,scope,message});}};
 const resolve=file=>{
  if(typeof file!=='string'||!file.startsWith('docs/dev/')||file.includes('\\')||path.isAbsolute(file)||file.split('/').includes('..'))throw Error('invalid_evidence_path');
  const target=path.resolve(root,file),real=fs.realpathSync(target),base=fs.realpathSync(path.join(root,'docs/dev'));
  const relative=path.relative(base,real);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('invalid_evidence_path');
  return target;
 };
 const cache=new Map();
 function read(ref,scope,text=false){
  if(!ref||typeof ref.file!=='string'){add('evidence_missing',scope,'缺少原始证据引用。');return null;}
  try{
   const target=resolve(ref.file),bytes=fs.readFileSync(target);
   if(!/^[a-f0-9]{64}$/.test(ref.sha256||'')||sha(bytes)!==ref.sha256){add('evidence_hash_mismatch',scope,ref.file);return null;}
   if(text)return bytes.toString('utf8');
   const parent=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));let value=parent;
   if(ref.pointer){if(!/^\/records\/(?:0|[1-9]\d*)$/.test(ref.pointer))throw Error('invalid_evidence_pointer');value=parent.records?.[Number(ref.pointer.split('/').at(-1))];if(!value)throw Error('invalid_evidence_pointer');}
   return{value,parent};
  }catch(e){add(e.message==='invalid_evidence_path'||e.message==='invalid_evidence_pointer'?e.message:'evidence_unreadable',scope,ref.file);return null;}
 }
 function record(ref,scope){
  const key=JSON.stringify([ref?.file,ref?.pointer||'']),cacheKey=JSON.stringify(ref);if(cache.has(cacheKey))return cache.get(cacheKey);
  const data=read(ref,scope);if(!data)return null;
  const r={...normalize(data.value,data.parent),key,ref,batch:ref.pointer?ref.file:path.posix.dirname(ref.file),order:Number(ref.pointer?.split('/').at(-1)??path.posix.basename(ref.file).match(/^(\d+)\.json$/)?.[1])};
  if(!r.name||!r.source_commit||!r.reader_sha256)add('record_metadata_missing',scope,ref.file);
  r.page=ref.page?read(ref.page,scope)?.value:null;
  if(r.actual.status==='ok'&&!r.page)add('page_evidence_missing',scope,ref.file);
  cache.set(cacheKey,r);return r;
 }
 function sourceRecords(search){
  if(search.ref.pointer){const parent=JSON.parse(fs.readFileSync(resolve(search.ref.file),'utf8'));return(parent.records||[]).map((r,i)=>({...normalize(r,parent),order:i}));}
  return fs.readdirSync(path.dirname(resolve(search.ref.file))).filter(n=>/^\d+\.json$/.test(n)).map(n=>{try{return{...normalize(JSON.parse(fs.readFileSync(path.join(root,search.batch,n),'utf8'))),order:Number(n.slice(0,-5))};}catch{return null;}}).filter(Boolean);
 }
 function withinSearch(r,search,scope){
  if(r.batch!==search.batch||!Number.isFinite(r.order)||r.order<=search.order){add('cross_batch_records',scope,r.ref.file);return false;}
  let next;try{next=sourceRecords(search).filter(x=>x.name==='pdd_search'&&x.order>search.order).sort((a,b)=>a.order-b.order)[0];}catch{add('evidence_unreadable',scope,'无法核对搜索段。');return false;}
  if(next&&r.order>=next.order){add('multiple_search_segments',scope,r.ref.file);return false;}
  const start=Date.parse(r.start),finish=Date.parse(search.finish||search.start);
  if(!Number.isFinite(start)||!Number.isFinite(finish)||start<finish||start-finish>=1800000){add('search_source_time_invalid',scope,r.ref.file);return false;}
  return true;
 }
 const amounts=rows=>(rows||[]).flatMap(s=>[...String(s).matchAll(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/g)].map(m=>Math.round(Number(m[1])*100)));
 function detailValid(r){return r?.name==='pdd_read_item'&&r.input.entry==='search'&&r.actual.status==='ok'&&!!r.actual.goods_id&&!!r.actual.title&&!!r.actual.price&&r.page?.goods_id===r.actual.goods_id&&r.page?.title===r.actual.title&&amounts(r.page.detail_prices).some(v=>amounts([r.actual.price]).includes(v));}
 function variant(r){
  if(r?.name!=='pdd_read_sku'||r.actual.status!=='ok')return null;
  let expected;try{const input=String(r.input.goods_id);expected=/^[1-9]\d*$/.test(input)?input:new URL(input).searchParams.get('goods_id');}catch{return null;}
  if(expected!==r.actual.goods_id)return null;
  const groups=r.actual.spec_groups;if(!Array.isArray(groups)||!groups.length||new Set(groups.map(g=>g.label)).size!==groups.length)return null;
  const rows=(r.actual.skus||[]).filter(v=>v.variant_price_verified===true&&v.selection_available!==false&&v.available!==false&&Object.keys(v.specs||{}).length===groups.length&&groups.every(g=>g.options?.includes(v.specs[g.label]))&&Number.isFinite(v.price_assessment?.reference_price)&&v.price_assessment.reference_price>=0&&Number(v.price)===v.price_assessment.reference_price);
  if(rows.length!==1)return null;
  const v=rows[0],p=r.page,selected=p?.dialog_count===1?p.selected:p?.bound?.selected;
  if(!p||p.goods_id!==r.actual.goods_id||p.bound?.goods_id!==r.actual.goods_id||!same(selected,v.specs)||(r.input.spec_selection&&!same(r.input.spec_selection,v.specs))||String(p.bound?.selected_sku_id)!==String(v.sku_id))return null;
  const priceRows=p.dialog_count===1?[...(p.panel_prices||[]),...(p.secondary_prices||[])]:p.detail_prices;
  if(!amounts(priceRows).includes(Math.round(v.price_assessment.reference_price*100)))return null;
  return v;
 }
 if(manifest?.schema_version!==2)add('manifest_version_invalid','release','需要带原始证据引用的版本2清单。');
 let categoriesPassed=0;
 const impact=manifest?.impact_analysis?read(manifest.impact_analysis,'inheritance',true):null;
 for(const category of categoryNames){
  const item=manifest?.categories?.[category];if(!item){add('category_missing',category,'缺少完整品类批次。');continue;}
  const before=blockers.length,search=record(item.search,category),records=(item.records||[]).map(r=>record(r,category)).filter(Boolean);
  if(!['historical_applicable','current_version_live'].includes(item.classification))add('classification_missing',category,'缺少原版本与当前版本分类。');
  if(item.classification==='historical_applicable'&&!impact)add('impact_analysis_missing',category,'历史证据必须附变更影响分析。');
  if(!search||search.name!=='pdd_search'||search.actual.status!=='ok'||!search.actual.results?.length||search.actual.search_context?.result_kind==='recommendations_after_no_results')add('category_search_invalid',category,'搜索证据无可核验结果。');
  const candidates=new Set(search?.actual.results?.map(r=>r.goods_id)||[]),details=new Set();
  const belonging=search?records.filter(r=>r.key!==search.key&&withinSearch(r,search,category)):[];
  if(records.some(r=>r.name==='pdd_search'&&r.key!==search?.key))add('multiple_search_segments',category,'品类汇总只能对应一个搜索段。');
  for(const r of belonging)if(detailValid(r)&&candidates.has(r.actual.goods_id))details.add(r.actual.goods_id);
  if(details.size<3)add('category_details_incomplete',category,`同次搜索仅核对${details.size}个不同商品详情，需要3个。`);
  if(!belonging.some(r=>details.has(r.actual.goods_id)&&variant(r)))add('category_sku_incomplete',category,'缺少与完整规格关联的已核验参考价。');
  if(item.classification==='current_version_live'){
   if(records.some(r=>r.actual.status!=='ok'))add('current_batch_failed',category,'新批次包含失败，不能作为无中断完整批。');
   if(records.some(r=>r.reader_sha256!==manifest.runtime?.reader_sha256))add('runtime_hash_mismatch',category,'运行读取器与清单不一致。');
   if(search?.input.exclude_group_purchase!==true)add('group_filter_missing',category,'新搜索须显式排除明确多人团。');
  }
  if(blockers.length===before)categoriesPassed++;
 }
 const nonDefault=new Set();
 for(const pair of manifest?.non_default||[]){
  const base=record(pair.base,'non_default'),selected=record(pair.selected,'non_default'),b=variant(base),s=variant(selected);
  if(b&&s&&base.actual.goods_id===selected.actual.goods_id&&same(selected.input.spec_selection,s.specs)&&!same(b.specs,s.specs)&&Object.keys(b.specs).length===Object.keys(s.specs).length)nonDefault.add(selected.actual.goods_id);
 }
 if(nonDefault.size<3)add('non_default_incomplete','non_default',`仅${nonDefault.size}个不同商品的非默认组合通过，需要3个。`);
 let recommendationsPassed=0;
 for(const category of ['cat_food','earphones']){
  const item=manifest?.recommendations?.[category];if(!item){add('recommendation_missing',category,'缺少推荐比较及原始读取记录。');continue;}
  const before=blockers.length,comparison=read(item.comparison,category)?.value,records=(item.records||[]).map(r=>record(r,category)).filter(Boolean);
  const details=new Set(records.filter(detailValid).map(r=>r.actual.goods_id)),skus=records.filter(r=>variant(r)&&details.has(r.actual.goods_id));
  if(new Set(skus.map(r=>r.actual.goods_id)).size<3)add('recommendation_samples_incomplete',category,'至少3个商品须有详情和已核验规格记录；被排除候选保留原原因。');
  if(comparison?.comparison_complete!==true||comparison.candidates?.length<2)add('comparison_incomplete',category,'缺少至少2个有差异的可追溯选择。');
  for(const candidate of comparison?.candidates||[]){
   const matched=skus.find(r=>r.actual.goods_id===candidate.goods_id&&same(variant(r)?.specs,candidate.specs)&&variant(r)?.price_assessment.reference_price===candidate.price_assessment?.reference_price);
   if(!matched)add('comparison_candidate_unverified',category,String(candidate.goods_id));
   const actual=matched&&variant(matched)?.price_assessment;
   if(actual&&['conditions','unknowns'].some(k=>(actual[k]||[]).some(v=>!(candidate.price_assessment?.[k]||[]).includes(v))))add('comparison_conditions_lost',category,String(candidate.goods_id));
  }
  if(blockers.length===before)recommendationsPassed++;
 }
 const validation=manifest?.validation||{};
 const local=read(validation.local,'local')?.value;if(!(local?.tests_passed>0&&local.tests_failed===0&&local.smoke==='passed'))add('local_validation_incomplete','local','缺少本地完整通过记录。');
 const sdk=read(validation.sdk,'sdk')?.value;if(!(sdk?.results?.length>=2&&sdk.results.every(r=>r.tool_count===10&&r.prompt_count===3&&r.schemas==='validated_by_sdk'&&r.ping==='passed')))add('sdk_validation_incomplete','sdk','缺少SDK双连接、10工具及3模板记录。');
 const install=read(validation.install,'install')?.value;if(!(install?.exit_code===0&&install.source_files_matched===true&&install.adapters===9&&install.tools===10&&install.prompts===3&&install.config?.cdp==='http://127.0.0.1:9335'&&install.config.writes_enabled==='0'&&install.config.absolute_server_path===true&&install.private_source_directories_excluded===true))add('install_validation_incomplete','install','安装、配置或隐私排除未通过。');
 const gui=read(validation.gui,'gui')?.value;if(!(gui?.gui_restart==='verified_current_gui_after_restart'&&gui.last_sku_verified===true&&gui.browser_connected===true&&gui.writes_enabled===false))add('gui_validation_incomplete','gui','缺少GUI实际重启后的读取与规格记录。');
 const digest=reviewDigest(manifest||{});let review;
 try{review=JSON.parse(fs.readFileSync(resolve(manifest.manual_review_file),'utf8'));}catch{}
 if(review?.status!=='passed'||!review.reviewer||review.confirmation_source!=='user_confirmation'||!Number.isFinite(Date.parse(review.reviewed_at)))add('manual_review_pending','manual','用户人工核对尚未完成；代理核对不代签。');
 else if(review.evidence_digest!==digest)add('manual_review_digest_mismatch','manual','人工确认对应的证据已变化，须核对新的清单。');
 const automatedPassed=!blockers.some(b=>!b.code.startsWith('manual_'));
 return{schema_version:2,release_allowed:blockers.length===0,automated_passed:automatedPassed,categories_passed:categoriesPassed,category_count:10,non_default_goods:nonDefault.size,recommendations_passed:recommendationsPassed,review_digest:digest,manual_review:review?.status==='passed'&&!blockers.some(b=>b.code.startsWith('manual_'))?'passed':'pending',blockers};
}
module.exports={inspectEvidence,reviewDigest,normalize};
