'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {acquireAcceptance,withAcceptance}=require('../tools/acceptance-lock.cjs');
test('second process cannot acquire active acceptance lock; failure releases owned lock',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pdd-acceptance-'));
 try{const release=acquireAcceptance(root);const child=spawnSync(process.execPath,['-e',`require(${JSON.stringify(require.resolve('../tools/acceptance-lock.cjs'))}).acquireAcceptance(process.argv[1])`,root],{encoding:'utf8'});assert.notEqual(child.status,0);assert.match(child.stderr,/ACCEPTANCE_BUSY/);release();
 await assert.rejects(withAcceptance(root,async()=>{throw Error('fixture failure');}),/fixture failure/);const again=acquireAcceptance(root);again();
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
