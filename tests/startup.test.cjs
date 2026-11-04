'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
test('startup diagnostic captures first output and timeout without exposing child output',async()=>{
 const probe=require('../tools/opencli-runtime.cjs').probeProcess;
 const good=await probe(process.execPath,['-e','console.log("sensitive text")'],{timeout:2000});assert.equal(good.exit_code,0);assert.ok(good.stages.some(s=>s.phase==='first_output'));assert.equal(JSON.stringify(good).includes('sensitive text'),false);
 const hung=await probe(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:100});assert.equal(hung.timed_out,true);assert.equal(hung.diagnostic,'local_process_timeout');
});
