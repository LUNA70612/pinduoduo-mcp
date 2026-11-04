'use strict';
const fs=require('node:fs');const path=require('node:path');
function checkCategoryEvidence(summaries){
 const nonDefault=new Set();
 for(const category of Object.keys(require('./category-acceptance.cjs').categories)){
  const s=summaries[category];
  if(!s||s.category!==category||s.business_accepted!==true||s.manual_page_crosscheck!=='passed'||s.tool_count!==10)throw Error(`${category} 十品类真机验收未完成。`);
  const passed=(s.records||[]).filter(r=>r.manual_page_crosscheck==='passed'&&r.actual?.status==='ok');
  const search=passed.find(r=>r.name==='pdd_search'&&r.actual.results?.length&&r.actual.search_context?.result_kind!=='recommendations_after_no_results');
  const ids=new Set(search?.actual.results.map(p=>p.goods_id)||[]);
  const details=new Set(passed.filter(r=>r.name==='pdd_read_item'&&r.input?.entry==='search'&&ids.has(r.actual.goods_id)&&r.actual.price&&r.actual.title).map(r=>r.actual.goods_id));
  const verified=r=>r.name==='pdd_read_sku'&&details.has(r.actual.goods_id)&&r.actual.skus?.some(v=>v.variant_price_verified===true&&v.price_assessment?.reference_price!==null&&typeof v.price_assessment?.reference_price==='number');
  if(!search||details.size<3||!passed.some(verified))throw Error(`${category} 搜索、三个详情及明确规格参考价未核验。`);
  for(const r of passed.filter(verified))if(r.case==='non_default_sku'&&r.base_specs&&r.input.spec_selection&&r.actual.skus.some(v=>v.variant_price_verified&&Object.keys(v.specs||{}).length===Object.keys(r.input.spec_selection).length&&Object.entries(r.input.spec_selection).every(([k,val])=>v.specs[k]===val)&&Object.entries(r.base_specs).some(([k,val])=>v.specs[k]!==val)))nonDefault.add(r.actual.goods_id);
 }
 if(nonDefault.size<3)throw Error('至少三个商品的非默认指定组合尚未核验。');
}
function checkRecommendationEvidence(summaries) {
  for (const category of ['cat_food','earphones']) {
    const s=summaries[category];
    if (!s || s.category!==category || s.business_accepted!==true || s.comparison_complete!==true || s.manual_page_crosscheck!=='passed' || s.tool_count!==10) throw Error(`${category} 未完成真机读取、人工核对及推荐闭环；不生成新的推荐发布包。`);
    const details=new Set((s.records||[]).filter(r=>r.name==='pdd_read_item'&&r.actual?.status==='ok'&&r.actual?.goods_id&&r.actual?.price&&r.manual_page_crosscheck==='passed').map(r=>r.actual.goods_id));
    const skus=new Set((s.records||[]).filter(r=>r.name==='pdd_read_sku'&&r.actual?.status==='ok'&&r.manual_page_crosscheck==='passed'&&r.actual?.skus?.some(v=>v.variant_price_verified===true&&v.price!==null)).map(r=>r.actual.goods_id));
    if (details.size<3 || skus.size<3 || [...details].filter(id=>skus.has(id)).length<3) throw Error(`${category} 至少 3 个商品的详情及规格价尚未核验；不生成新的推荐发布包。`);
  }
}
function inspectReleaseGate(root) {
  let manifest,problem;
  try {manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/dev/recommendation/release-gate.json'),'utf8'));}
  catch {manifest={schema_version:2};problem={code:'release_manifest_missing',scope:'release',message:'缺少可读取的 docs/dev/recommendation/release-gate.json。'};}
  const report=require('./release-evidence.cjs').inspectEvidence(root,manifest);
  if(problem){report.blockers.unshift(problem);report.automated_passed=false;report.release_allowed=false;}
  return report;
}
function verifyReleaseGate(root) {
  const report=inspectReleaseGate(root);
  if(!report.release_allowed){const error=Error('发布验收未完成；未生成新发布包。\n'+report.blockers.map(b=>`[${b.scope}/${b.code}] ${b.message}`).join('\n'));error.report=report;throw error;}
  return report;
}
module.exports={checkRecommendationEvidence,checkCategoryEvidence,inspectReleaseGate,verifyReleaseGate};
