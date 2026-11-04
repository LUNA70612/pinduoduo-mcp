'use strict';
// One persistent stdio connection; reviewed requests arrive through a local inbox.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const {ROOT,browserConfig}=require('../tools/config.cjs'),{withAcceptance}=require('../tools/acceptance-lock.cjs'),{createStdioClient}=require('../tools/stdio-client.cjs'),{sanitize}=require('./recommendation-acceptance.cjs'),{capture}=require('./capture-page-evidence.cjs');
async function main(){
 const label=process.argv[2];if(!/^[a-z0-9-]{1,60}$/.test(label||''))throw Error('需要唯一批次名');
 return withAcceptance(ROOT,async()=>{
  const base=path.join(ROOT,'docs/dev/final-rounds');fs.mkdirSync(base,{recursive:true});
  const dir=path.join(base,label);fs.mkdirSync(dir,{recursive:false});
  const inbox=path.join(ROOT,'work',label);fs.mkdirSync(inbox,{recursive:false});
  const config=browserConfig(),browser=await(await fetch(config.endpoint+'/json/version',{signal:AbortSignal.timeout(5000)})).json();
  const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const meta={source_commit:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),reader_sha256:sha(path.join(ROOT,'runtime/home/.opencli/clis/pdd/_dom.cjs')),adapter_sha256:sha(path.join(ROOT,'runtime/home/.opencli/clis/pdd/_adapter.cjs')),comparison_sha256:sha(path.join(ROOT,'runtime/home/.opencli/clis/pdd/_comparison.cjs')),browser:browser.Browser,cdp:config.endpoint,interval_ms:90000,manual_page_crosscheck:'pending'};
  const client=createStdioClient({timeout:240000,env:{...process.env,OPENCLI_CDP_ENDPOINT:config.endpoint,PDD_ENABLE_WRITES:'0',PDD_WRITE_TEST_MODE:'0'}});
  let index=0;const searches=[],details=new Set(),skus=new Set();
  try{await client.request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'reviewed-acceptance-session',version:'1'}});client.notify('notifications/initialized');
   fs.writeFileSync(path.join(dir,'session.json'),JSON.stringify(meta,null,2));console.log(JSON.stringify({ready:true,label,inbox}));
   while(true){const file=path.join(inbox,`${index}.json`);if(!fs.existsSync(file)){await new Promise(r=>setTimeout(r,250));continue;}
    const input=JSON.parse(fs.readFileSync(file,'utf8'));if(input.close)break;
    if(!['pdd_status','pdd_search','pdd_read_item','pdd_read_sku'].includes(input.name))throw Error('只允许状态、搜索、详情、规格');
    const args=input.arguments||{};
    if(input.name==='pdd_search'){if(searches.length>=3||args.limit>10)throw Error('搜索额度超限');searches.push(args.query);}
    if(input.name==='pdd_read_item')details.add(args.url);if(details.size>6)throw Error('详情额度超限');
    if(input.name==='pdd_read_sku')skus.add(args.goods_id);if(skus.size>3)throw Error('规格商品额度超限');
    const record={...meta,index,input,start:new Date().toISOString()};
    fs.writeFileSync(path.join(dir,`${index}-started.json`),JSON.stringify(record,null,2));
    let data;try{const response=await client.request('tools/call',input);data=response.result?.structuredContent||{status:'rpc_error',code:response.error?.code};
     let mediaIndex=0;for(const block of response.result?.content||[])if(block.type==='image'){const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[block.mimeType];if(ext)fs.writeFileSync(path.join(dir,index+'-image-'+mediaIndex+++'.'+ext),Buffer.from(block.data,'base64'));}
}catch(e){data={status:'timeout',diagnostic:'client_execution_state_unknown'};}
    record.finish=new Date().toISOString();record.actual=sanitize(data);
    fs.writeFileSync(path.join(dir,`${index}.json`),JSON.stringify(record,null,2));
    if(input.name!=='pdd_status')try{const proof=await capture(input.name==='pdd_search'?'search_result.html':data.goods_id||args.goods_id||require('../clis/pdd/_shared.cjs').goodsId(args.url),config.endpoint);fs.writeFileSync(path.join(dir,`${index}-page.json`),JSON.stringify(proof,null,2));}catch{record.page_evidence_error=true;fs.writeFileSync(path.join(dir,`${index}.json`),JSON.stringify(record,null,2));}
    console.log(JSON.stringify({index,status:data.status,diagnostic:data.diagnostic,goods_id:data.goods_id,file:path.join(dir,`${index}.json`)}));index++;
    if(data.status!=='ok'){fs.writeFileSync(path.join(dir,'STOPPED.json'),JSON.stringify({index,status:data.status,diagnostic:data.diagnostic}));break;}
   }
  }finally{client.close();}
 });
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};
