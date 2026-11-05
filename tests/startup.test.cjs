'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const childProcess=require('node:child_process');
const runtimeFile=require.resolve('../tools/opencli-runtime.cjs');
const commands=['search','detail','auth','resume','browse_home','read_cart','read_sku','contact_seller','add_cart'];

// Only the slow OS process boundary is replaced; probeProcess and its timers run unchanged.
function controlledProcess(t) {
 t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
 const children=[];
 const spawn=t.mock.method(childProcess,'spawn',()=>{
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kills=0;
  child.kill=()=>{child.kills++;return true;};children.push(child);return child;
 });
 const cached=require.cache[runtimeFile];delete require.cache[runtimeFile];
 const probe=require(runtimeFile).probeProcess;
 t.after(()=>{delete require.cache[runtimeFile];if(cached)require.cache[runtimeFile]=cached;});
 return {probe,children,spawn,tick:ms=>t.mock.timers.tick(ms)};
}
function stdout(child,value) {child.stdout.emit('data',Buffer.from(value));}

// Run the actual doctor script, isolating installation files and network access only.
function runDoctor(probe) {
 const captured=[],errors=[],processState={versions:process.versions,env:{},execPath:process.execPath,exitCode:0};
 const requires={
  'node:fs':{readdirSync:()=>commands.map(name=>`${name}.js`),existsSync:()=>true,readFileSync:()=>Buffer.from('installed adapter')},
  '../tools/config.cjs':{ROOT:path.resolve('/controlled-install'),browserConfig:()=>({endpoint:'http://127.0.0.1:65534',profile:'controlled'})},
  '../tools/client-core.cjs':{childEnv:()=>({}),connected:async()=>false},
  '../node_modules/@jackwener/opencli/package.json':{version:'2.0.2'},
  '../tools/opencli-runtime.cjs':{probeProcess:probe,entry:()=>'/controlled-opencli.js'},
  '../tools/pdd.cjs':require('../tools/pdd.cjs')
 };
 const done=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../scripts/doctor.cjs'),'utf8'),{
  require:name=>Object.hasOwn(requires,name)?requires[name]:require(name),process:processState,
  console:{log:value=>captured.push(JSON.parse(value)),error:value=>errors.push(value)}
 });
 return {done,captured,errors,processState};
}

test('startup diagnostics measure spawn, stdout and stderr without retaining sensitive content',async t=>{
 const c=controlledProcess(t),pending=c.probe('private-command',['private-argument'],{env:{PRIVATE_TOKEN:'token-secret'},timeout:60000,expected:commands});
 const child=c.children[0];c.tick(5);child.emit('spawn');c.tick(15);
 stdout(child,commands.join('\n')+'\nprivate stdout');child.stderr.emit('data',Buffer.from('私密 stderr'));
 c.tick(10);child.emit('close',0,null);const result=await pending;
 assert.equal(result.discovered,true);assert.equal(result.diagnostic,'ok');assert.equal(result.timeout_ms,60000);
 assert.equal(result.spawn_ms,5);assert.equal(result.first_output_ms,20);assert.equal(result.stderr_bytes,13);
 assert.equal(result.timeout_phase,null);assert.equal(result.elapsed_ms,30);assert.equal(result.expected_commands,9);
 assert.deepEqual(result.stages.map(s=>s.phase),['requested','process_started','first_output','commands_discovered','process_exited']);
 for(const secret of ['private-command','private-argument','PRIVATE_TOKEN','token-secret','private stdout','私密 stderr'])assert.equal(JSON.stringify(result).includes(secret),false);
 c.tick(60000);assert.equal(child.kills,0);assert.equal(c.spawn.mock.callCount(),1);
});

test('doctor permits discovery after 30 seconds within its single 60 second budget',async t=>{
 const c=controlledProcess(t),doctor=runDoctor(c.probe),child=c.children[0];child.emit('spawn');
 c.tick(45000);stdout(child,commands.join('\n'));child.emit('close',0,null);await doctor.done;
 const report=doctor.captured[0],discovery=report.checks.find(check=>check.name==='adapter_discovery');
 assert.equal(doctor.errors.length,0);assert.equal(doctor.processState.exitCode,0);assert.equal(report.status,'ok');
 assert.equal(discovery.detail.timeout_ms,60000);assert.equal(discovery.detail.timed_out,false);
 assert.equal(discovery.detail.first_output_ms,45000);assert.equal(discovery.detail.expected_commands,9);
 assert.equal(child.kills,0);assert.equal(c.spawn.mock.callCount(),1);
});

test('probe default remains 30 seconds and timeout before stdout kills once without retry',async t=>{
 const c=controlledProcess(t),pending=c.probe('node',[],{expected:commands}),child=c.children[0];
 child.emit('spawn');child.stderr.emit('data',Buffer.from('stderr-only-secret'));c.tick(29999);assert.equal(child.kills,0);
 c.tick(1);assert.equal(child.kills,1);child.emit('close',null,'SIGTERM');const result=await pending;
 assert.equal(result.timeout_ms,30000);assert.equal(result.spawn_ms,0);assert.equal(result.first_output_ms,null);
 assert.equal(result.timeout_phase,'before_stdout');assert.equal(result.stderr_bytes,18);assert.equal(result.discovered,false);
 assert.equal(result.diagnostic,'local_process_timeout');assert.equal(JSON.stringify(result).includes('stderr-only-secret'),false);
 c.tick(60000);assert.equal(child.kills,1);assert.equal(c.spawn.mock.callCount(),1);
});

test('timeout after stdout cannot report discovered even when the process later exits zero',async t=>{
 const c=controlledProcess(t),pending=c.probe('node',[],{timeout:60000,expected:commands}),child=c.children[0];
 child.emit('spawn');c.tick(12000);stdout(child,commands.join('\n'));c.tick(48000);child.emit('close',0,null);
 const result=await pending;assert.equal(result.discovered,false);assert.equal(result.timed_out,true);
 assert.equal(result.timeout_phase,'after_stdout');assert.equal(result.first_output_ms,12000);
 assert.equal(result.diagnostic,'local_process_timeout');assert.equal(result.exit_code,0);assert.equal(child.kills,1);
 assert.equal(result.stages.some(s=>s.phase==='commands_discovered'),false);assert.equal(c.spawn.mock.callCount(),1);
});

test('late stdout cannot change the phase recorded when the timeout occurred',async t=>{
 const c=controlledProcess(t),pending=c.probe('node',[],{timeout:60000,expected:commands}),child=c.children[0];
 child.emit('spawn');c.tick(60000);c.tick(1);stdout(child,commands.join('\n'));child.emit('close',0,null);
 const result=await pending;assert.equal(result.discovered,false);assert.equal(result.timeout_phase,'before_stdout');
 assert.equal(result.first_output_ms,60001);assert.equal(result.diagnostic,'local_process_timeout');
});

test('spawn failure retains its error code and leaves spawn and stdout timing unknown',async t=>{
 const c=controlledProcess(t),pending=c.probe('missing',[],{timeout:60000,expected:commands}),child=c.children[0];
 child.emit('error',Object.assign(Error('private failure details'),{code:'ENOENT'}));child.emit('close',-4058,null);
 const result=await pending;assert.equal(result.diagnostic,'ENOENT');assert.equal(result.discovered,false);
 assert.equal(result.spawn_ms,null);assert.equal(result.first_output_ms,null);assert.equal(result.stderr_bytes,0);
 assert.equal(result.timeout_phase,null);assert.equal(result.timed_out,false);assert.equal(result.timeout_ms,60000);
 assert.equal(JSON.stringify(result).includes('private failure details'),false);c.tick(60000);assert.equal(child.kills,0);
 assert.equal(c.spawn.mock.callCount(),1);
});

for(const scenario of [
 {name:'nonzero exit',code:1,output:commands.join('\n')},
 {name:'missing adapter',code:0,output:commands.slice(0,-1).join('\n')}
])test(`command discovery rejects ${scenario.name}`,async t=>{
 const c=controlledProcess(t),pending=c.probe('node',[],{timeout:60000,expected:commands}),child=c.children[0];
 child.emit('spawn');stdout(child,scenario.output);child.emit('close',scenario.code,null);const result=await pending;
 assert.equal(result.discovered,false);assert.equal(result.diagnostic,'local_command_discovery_failed');
 assert.equal(result.timed_out,false);assert.equal(result.timeout_phase,null);assert.equal(result.exit_code,scenario.code);
 assert.equal(c.spawn.mock.callCount(),1);
});

for(const scenario of ['timeout','nonzero','missing'])test(`doctor fails once for ${scenario} rather than bypassing discovery`,async t=>{
 const c=controlledProcess(t),doctor=runDoctor(c.probe),child=c.children[0];child.emit('spawn');
 if(scenario==='timeout') {c.tick(59999);assert.equal(child.kills,0);c.tick(1);assert.equal(child.kills,1);stdout(child,commands.join('\n'));}
 else stdout(child,(scenario==='missing'?commands.slice(0,-1):commands).join('\n'));
 child.emit('close',scenario==='nonzero'?1:0,null);await doctor.done;
 assert.equal(doctor.errors.length,0);assert.equal(doctor.processState.exitCode,1);assert.equal(doctor.captured[0].status,'failed');
 assert.equal(doctor.captured[0].checks.find(check=>check.name==='adapter_discovery').ok,false);
 assert.equal(c.spawn.mock.callCount(),1);
});
test('startup diagnostic captures first output and timeout without exposing child output',async()=>{
 const probe=require('../tools/opencli-runtime.cjs').probeProcess;
 const good=await probe(process.execPath,['-e','console.log("sensitive text")'],{timeout:2000});assert.equal(good.exit_code,0);assert.ok(good.stages.some(s=>s.phase==='first_output'));assert.equal(JSON.stringify(good).includes('sensitive text'),false);
 const hung=await probe(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:100});assert.equal(hung.timed_out,true);assert.equal(hung.diagnostic,'local_process_timeout');
});
