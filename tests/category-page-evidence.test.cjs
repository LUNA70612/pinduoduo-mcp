'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {capturePageEvidence}=require('../scripts/category-acceptance.cjs');
const workRoot=path.resolve(__dirname,'../work');
fs.mkdirSync(workRoot,{recursive:true});
test('category evidence persists only the exact product page proof before followup',()=>{
 const dir=fs.mkdtempSync(path.join(workRoot,'category-proof-'));
 try{const result=capturePageEvidence({root:path.resolve(__dirname,'..'),directory:dir,category:'household',index:2,goodsId:'123',run:()=>JSON.stringify({goods_id:'123',title:'洗衣液',attributes:[]})});assert.equal(result.status,'saved');const proof=JSON.parse(fs.readFileSync(result.file,'utf8'));assert.equal(proof.goods_id,'123');assert.equal(fs.existsSync(result.file),true);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('category evidence refuses a mismatched browser page instead of saving it as proof',()=>{
 const dir=fs.mkdtempSync(path.join(workRoot,'category-proof-'));
 try{assert.throws(()=>capturePageEvidence({root:path.resolve(__dirname,'..'),directory:dir,category:'household',index:0,goodsId:'123',run:()=>JSON.stringify({goods_id:'999'})}),/does not match/);assert.equal(fs.readdirSync(dir).length,0);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
