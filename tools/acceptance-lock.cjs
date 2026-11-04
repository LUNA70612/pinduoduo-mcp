'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function acquireAcceptance(root){
 const folder=path.join(root,'runtime','state');fs.mkdirSync(folder,{recursive:true});
 const file=path.join(folder,'acceptance.lock'),token=crypto.randomUUID();
 let fd;try{fd=fs.openSync(file,'wx');}catch(e){if(e.code==='EEXIST')throw Error('ACCEPTANCE_BUSY: 已有验收批次或未确认的旧锁；不启动第二个控制器。');throw e;}
 try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,token,started_at:new Date().toISOString()}));}finally{fs.closeSync(fd);}
 return()=>{if(JSON.parse(fs.readFileSync(file,'utf8')).token!==token)throw Error('验收锁所有者变化，保留现场。');fs.unlinkSync(file);};
}
async function withAcceptance(root,task){const release=acquireAcceptance(root);try{return await task();}finally{release();}}
module.exports={acquireAcceptance,withAcceptance};
