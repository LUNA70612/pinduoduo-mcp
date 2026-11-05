'use strict';
// Minimal runtime resolver: locate the installed @jackwener/opencli CLI entry.
const fs = require('node:fs');
const path = require('node:path');
const {spawn}=require('node:child_process');
function probeProcess(command,args,{env=process.env,cwd=path.resolve(__dirname,'..'),timeout=30000,expected=[]}={}) {
  return new Promise(resolve=>{
    const start=Date.now(),stages=[{phase:'requested',elapsed_ms:0}];let output='',bytes=0,first=false,timedOut=false;
    let spawnMs=null,firstOutputMs=null,stderrBytes=0,timeoutPhase=null;
    const child=spawn(command,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const stage=phase=>stages.push({phase,elapsed_ms:Date.now()-start});
    child.once('spawn',()=>{spawnMs=Date.now()-start;stage('process_started');});
    const read=chunk=>{bytes+=chunk.length;if(!first){first=true;firstOutputMs=Date.now()-start;stage('first_output');}if(output.length<65536)output+=chunk.toString();};
    child.stdout.on('data',read);child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;});
    const timer=setTimeout(()=>{timedOut=true;timeoutPhase=first?'after_stdout':'before_stdout';stage('timeout');child.kill();},timeout);
    let errorCode=null;child.once('error',e=>{errorCode=e.code||'SPAWN_FAILED';});
    child.once('close',(code,signal)=>{clearTimeout(timer);const discovered=!timedOut&&!errorCode&&code===0&&expected.every(name=>output.includes(name));if(discovered&&expected.length)stage('commands_discovered');stage('process_exited');resolve({exit_code:code,signal:signal||null,timed_out:timedOut,diagnostic:timedOut?'local_process_timeout':errorCode||(!discovered?'local_command_discovery_failed':'ok'),elapsed_ms:Date.now()-start,stdout_bytes:bytes,expected_commands:expected.length,discovered,stages,timeout_ms:timeout,spawn_ms:spawnMs,first_output_ms:firstOutputMs,stderr_bytes:stderrBytes,timeout_phase:timeoutPhase});});
  });
}

function resolveEntry() {
  const candidates = [
    process.env.OPENCLI_BIN,
    path.join(__dirname, '..', 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return candidates[candidates.length - 1];
}

module.exports = {
  probeProcess,
  read: () => ({ active: '@jackwener/opencli' }),
  resolve: resolveEntry,
  entry: resolveEntry,
};
