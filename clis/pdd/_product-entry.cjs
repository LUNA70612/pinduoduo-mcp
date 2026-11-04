'use strict';
const fs=require('node:fs'),path=require('node:path');
const {ROOT}=require('./_shared.cjs');
// No URL tracking values or credentials: bind a successful click to this document.
function createEntryStore({directory=path.join(ROOT,'state/search-entry'),now=Date.now}={}){
 const file=path.join(directory,'search-product-entry.json');
 return{
  matches(goods_id,document_id){
   if(typeof document_id!=='number'||!Number.isFinite(document_id))return false;
   try{const r=JSON.parse(fs.readFileSync(file,'utf8'));return r.goods_id===goods_id&&r.document_id===document_id&&r.expires_at>now();}catch{return false;}
  },
  record(goods_id,document_id){
   if(typeof document_id!=='number'||!Number.isFinite(document_id))return;
   fs.mkdirSync(directory,{recursive:true});const temp=file+'.'+process.pid+'.tmp';
   fs.writeFileSync(temp,JSON.stringify({goods_id,document_id,expires_at:now()+30*60*1000}),{mode:0o600});fs.renameSync(temp,file);
  }
 };
}
module.exports={createEntryStore,entryStore:createEntryStore()};
