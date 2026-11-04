'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const {categories,runCategory}=require('../tools/category-acceptance.cjs');
const {browserConfig,ROOT}=require('../tools/config.cjs');
const {createStdioClient}=require('../tools/stdio-client.cjs');
const {sanitize}=require('./recommendation-acceptance.cjs');
function capturePageEvidence({root=ROOT,directory,category,index,goodsId,run=(file,target)=>execFileSync(process.execPath,[file,target],{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']})}){
 const target=/^[1-9]\d*$/.test(goodsId||'')?goodsId:'search_result.html',proof=JSON.parse(run(path.join(root,'scripts/capture-page-evidence.cjs'),target));
 const matches=target==='search_result.html'?proof.path==='/search_result.html':proof.goods_id===target;
 if(!matches)throw Error('Current browser page does not match the requested evidence target.');
 fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,`${category}-${String(index).padStart(2,'0')}-${target==='search_result.html'?'search':'product'}-page.json`);
 fs.writeFileSync(file,JSON.stringify(proof,null,2)+'\n');return{status:'saved',file};
}
async function main(){
 const feasibility=process.argv.includes('--feasibility'),selectionFollowup=process.argv.includes('--selection-followup');const names=process.argv.slice(2).filter(n=>!['--feasibility','--selection-followup'].includes(n));const selected=names.length?names:(feasibility?['household','kitchen']:Object.keys(categories));for(const n of selected)if(!Object.hasOwn(categories,n))throw Error('未知品类：'+n);
 if(feasibility&&selected.some(n=>!['household','kitchen'].includes(n)))throw Error('可行性小批仅允许日化和厨具');
 const config=browserConfig(),browser=await(await fetch(`${config.endpoint}/json/version`,{signal:AbortSignal.timeout(3000)})).json();
 const dir=path.join(ROOT,'docs/dev/search-first',`live-${new Date().toISOString().replaceAll(/[:.]/g,'-')}`);fs.mkdirSync(dir,{recursive:true});
 const batch={date:new Date().toISOString(),source_commit:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8',windowsHide:true}).trim(),browser:browser.Browser,cdp:config.endpoint,ua:browser['User-Agent'],planned_categories:selected,categories:{},stopped:false,business_accepted:false};
 const save=()=>fs.writeFileSync(path.join(dir,'batch.json'),JSON.stringify(batch,null,2)+'\n');save();
 for(const category of selected){
  const client=createStdioClient({env:{...process.env,PDD_ENABLE_WRITES:'0',PDD_WRITE_TEST_MODE:'0'}});
  const summary={category,browser:batch.browser,cdp:batch.cdp,ua:batch.ua,interval_ms:90000,source_commit:batch.source_commit,records:[],business_accepted:false,comparison_complete:false,manual_page_crosscheck:'pending'};
  const summaryFile=path.join(dir,category+'.json'),pageEvidenceDir=path.join(dir,category+'-pages');let pageEvidenceIndex=0;const saveSummary=()=>fs.writeFileSync(summaryFile,JSON.stringify(summary,null,2)+'\n');
  try{
   await client.request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'pdd-category-acceptance',version:'1'}});client.notify('notifications/initialized');
   summary.tool_count=(await client.request('tools/list')).result.tools.length;summary.prompt_count=(await client.request('prompts/list')).result.prompts.length;
   if(summary.tool_count!==10||summary.prompt_count!==3)throw Error('工具或模板数量不符');
   const outcome=await runCategory(category,async(name,args,metadata)=>{
    const record={name,input:args,...metadata,start:new Date().toISOString(),reader_sha256:createHash('sha256').update(fs.readFileSync(path.join(ROOT,'runtime/home/.opencli/clis/pdd/_dom.cjs'))).digest('hex'),manual_page_crosscheck:'pending'};
    let data;try{const response=await client.request('tools/call',{name,arguments:args});data=response.result?.structuredContent||{status:'rpc_error',code:response.error?.code};}catch{data={status:'rpc_error',code:'CLIENT_REQUEST_FAILED'};}
    record.finish=new Date().toISOString();record.actual=sanitize(data);record.passed=data.status==='ok'&&(name!=='pdd_read_sku'||data.skus?.some(s=>s.variant_price_verified));summary.records.push(record);saveSummary();
    try{const proof=capturePageEvidence({root:ROOT,directory:pageEvidenceDir,category,index:pageEvidenceIndex++,goodsId:name==='pdd_search'?null:data.goods_id||args.goods_id});record.page_evidence=path.relative(ROOT,proof.file);}catch(error){record.page_evidence_error='narrow page snapshot unavailable or target mismatch';}
    saveSummary();console.log(JSON.stringify({category,case:metadata.case,status:data.status,diagnostic:data.diagnostic,goods_id:data.goods_id,evidence:path.relative(ROOT,summaryFile)}));return data;
   },{feasibility,selectionFollowup});Object.assign(summary,outcome);saveSummary();batch.categories[category]={file:path.relative(dir,summaryFile),stop_all:outcome.stop_all,records:summary.records.length};
   if(outcome.stop_all){batch.stopped=true;batch.stop_category=category;break;}
  }finally{saveSummary();save();client.close();}
 }
 batch.finished_at=new Date().toISOString();save();console.log(JSON.stringify({evidence:path.relative(ROOT,dir),stopped:batch.stopped,completed_categories:Object.keys(batch.categories)}));
}
if(require.main===module)require('../tools/acceptance-lock.cjs').withAcceptance(ROOT,main).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={capturePageEvidence};
