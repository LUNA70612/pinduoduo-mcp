'use strict';
// Bounded real stdio acceptance. Never imports write tools or reads credentials.
const fs=require('node:fs');const path=require('node:path');
const{createHash}=require('node:crypto');const{execFileSync}=require('node:child_process');
const {createStdioClient}=require('../tools/stdio-client.cjs');const{browserConfig,ROOT}=require('../tools/config.cjs');
const cases={cat_food:{query:'成猫 全价 猫粮',price_max:200},earphones:{query:'蓝牙耳机',price_max:200}};
const stop=new Set(['auth_required','verification_required','service_unavailable','browser_disconnected','timeout','page_loading','operation_failed','parse_failed']);
function sourceCommit(){try{return execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();}catch{return'unknown-source-archive';}}
function sanitize(data){
 const keys=['status','code','diagnostic','state_diagnostic','message','navigation_source','verification_method','goods_id','title','price','price_basis','offer_conditions','coupon_offer','offer_eligibility_verified','variant_price_verified','shop','shop_id','service_claims','attributes','product_images','field_evidence','missing_fields','unit_price','count','scanned_count','matched_count','pending_count','excluded_count','filter_scope','ranking','truncated','spec_groups','skus','fetched_at'];
 const r=Object.fromEntries(keys.filter(k=>data[k]!==undefined).map(k=>[k,data[k]]));
 for(const key of ['price_assessment','search_context','empty_reason','excluded','diagnostic_evidence','search_return_method','navigation_evidence','selection_status','safe_entry_status','missing_evidence','entry_diagnostic','safe_entry_evidence'])if(data[key]!==undefined)r[key]=data[key];
 for(const key of ['resume_id','waiting_for_user','recoverable','execution_ended','retry_allowed','retried','page_evidence'])if(data[key]!==undefined)r[key]=data[key];
 if(data.results)r.results=data.results.map(p=>Object.fromEntries(['goods_id','title','price','price_basis','price_conditions','requires_group_purchase','url','variant_price_verified','budget_verified','display_price_matches'].filter(k=>p[k]!==undefined).map(k=>[k,p[k]])));
 return r;
}
async function readCandidates(products,call){
 for(const product of products){
  const detail=await call('pdd_read_item',{url:product.url,entry:'search',budget_max:200});
  if(detail.status!=='ok')return{stopped:true,stop_reason:'detail_read_failed'};
  const sku=await call('pdd_read_sku',{goods_id:product.goods_id,budget_max:200});
  if(sku.status!=='ok'||!sku.skus?.some(s=>s.variant_price_verified===true))return{stopped:true,stop_reason:'specification_unverified'};
 }
 return{stopped:false};
}
async function main(){
 const category=process.argv[2];if(!Object.hasOwn(cases,category))throw Error('参数：cat_food 或 earphones');
 const only=process.argv[3];if(only&&!/^[1-9]\d*$/.test(only))throw Error('可选第三参数必须是商品 ID。');
 const config=browserConfig();const version=await(await fetch(`${config.endpoint}/json/version`,{signal:AbortSignal.timeout(3000)})).json();
 const folder=path.join(ROOT,'docs/dev/recommendation',`${category}-${new Date().toISOString().replaceAll(/[:.]/g,'-')}`);fs.mkdirSync(folder,{recursive:true});
 const client=createStdioClient({env:{...process.env,PDD_ENABLE_WRITES:'0',PDD_WRITE_TEST_MODE:'0'}});const records=[];
 const summary={category,source_commit:sourceCommit(),browser:version.Browser,cdp:config.endpoint,ua:version['User-Agent'],interval_ms:90000,tool_count:0,planned_products:only?1:3,records,business_accepted:false,comparison_complete:false,manual_page_crosscheck:'pending',limitations:['默认测试预算 200 元，仅验证工具；未代替用户确认适用需求。','具体 SKU/优惠资格缺失时只列待核实候选。']};
 const save=()=>fs.writeFileSync(path.join(folder,'summary.json'),JSON.stringify(summary,null,2)+'\n');
 async function call(name,args){const start=new Date().toISOString();const reader_sha256=createHash('sha256').update(fs.readFileSync(path.join(ROOT,'runtime/home/.opencli/clis/pdd/_dom.cjs'))).digest('hex');const response=await client.request('tools/call',{name,arguments:args});const data=response.result?.structuredContent||{status:'rpc_error',code:response.error?.code};const item={name,input:args,start,finish:new Date().toISOString(),reader_sha256,expected:name==='pdd_read_sku'?'ok with at least one verified specification price':'ok with real page data',evidence_file:path.relative(ROOT,path.join(folder,'summary.json')),actual:sanitize(data),passed:name==='pdd_search'?data.status==='ok':name==='pdd_read_item'?data.status==='ok':data.status==='ok'&&data.skus?.some(s=>s.variant_price_verified),manual_page_crosscheck:'pending'};records.push(item);save();console.log(JSON.stringify({folder:path.relative(ROOT,folder),tool:name,goods_id:args.goods_id,status:data.status,diagnostic:data.diagnostic}));return data;}
 try{
  await client.request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'recommendation-acceptance',version:'1'}});client.notify('notifications/initialized');
  summary.tool_count=(await client.request('tools/list')).result.tools.length;if(summary.tool_count!==10)throw Error('expected 10 tools');
  summary.prompt_count=(await client.request('prompts/list')).result.prompts.length;
  const search=await call('pdd_search',{...cases[category],limit:10});if(stop.has(search.status)||search.status!=='ok'){summary.limitations.push('搜索未完成，停止该品类页面测试。');return;}
  const products=[...new Map((search.results||[]).filter(p=>(category!=='cat_food'||p.title.includes('猫粮'))&&(!only||p.goods_id===only)).map(p=>[p.goods_id,p])).values()].slice(0,3);
  if(only&&!products.length)summary.limitations.push('指定商品未出现在本次搜索结果中，不重建链接或替换测试商品。');
  summary.selected_goods=products.map(p=>p.goods_id);save();
  Object.assign(summary,await readCandidates(products,call));
  if(summary.stopped)summary.limitations.push('详情或规格读取失败，保存现场并暂停；不自动重试或导航到其他候选。');
  summary.limitations.push('自动调用结果不替代可见页面逐字段人工核对；无法确认 SKU 时不生成已核验推荐。');
 }finally{save();client.close();}
}
if(require.main===module)require('../tools/acceptance-lock.cjs').withAcceptance(ROOT,main).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={sanitize,readCandidates};
