import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import JSZip from 'jszip';
import {ProviderManager,freePort} from '../desktop/provider-manager.mjs';
import net from 'node:net';
import {createLocalServer,managedClientConnection} from '../desktop/server.mjs';
import {applyManagedConnection,managedConnectionCredential,freeLLMCatalogue,selectCatalogueModel,listProxyModels,discoverProxy} from '../lib/mico/providers.mjs';
import {complete} from '../lib/mico/agent.ts';
import {defaultConfig} from '../lib/mico/types.ts';

// FreeLLMAPI is the one managed provider whose key this app does not own: its /v1
// surface is bearer-gated and stays empty until the user pastes their own provider key
// and unified key. These tests pin the two things that made setup impossible:
//   1. the shared providers\npmrc pins ignore-scripts=true, which silently skips
//      better-sqlite3's install script, and the archive's bare npm\ layout leaves npm
//      unable to resolve itself so `npm run build` fails with MODULE_NOT_FOUND;
//   2. verifying /v1/models mid-setup 401s, aborting setup and stopping the server the
//      user needs in order to add that key in the first place.

const REPO_NAME='freellmapi-0.13.10';
const REPO_FILES=['server/package.json','client/package.json','cli/package.json','package.json'];

async function fakeManager(t,{requests=[]}={}){
 const base=await mkdtemp(path.join(os.tmpdir(),'mico-freellmapi-'));
 const dataDir=path.join(base,'data');
 const runtime=path.join(base,'node-runtime');
 await mkdir(runtime,{recursive:true});
 // node.exe is only ever passed to the stubbed run()/start(), so a placeholder is enough.
 await writeFile(path.join(runtime,'node.exe'),'');
 // A real archive so the extraction path is genuinely exercised. Its internal layout is
 // the one the bundler produces: npm\ at the archive root.
 const zip=new JSZip();
 zip.file('npm/bin/npm-cli.js','');
 zip.file('npm/bin/npm.cmd','');
 await writeFile(path.join(runtime,'npm-runtime.zip'),await zip.generateAsync({type:'nodebuffer'}));
 const manager=new ProviderManager({
  dataDir,runtimeDir:runtime,gatewayBase:'http://127.0.0.1:19286/managed/v1',gatewayKey:'internal',vault:{},
  fetchImpl:async url=>{
   requests.push(String(url));
   // The dashboard root answers; the authenticated catalogue answers 401, which is the
   // exact condition that used to abort setup.
   return String(url).endsWith('/v1/models')
    ? Response.json({error:{message:'Invalid API key'}},{status:401})
    : Response.json({ok:true});
  },
 });
 manager.freeLLMPort=async()=>3001;
 t.after(()=>rm(base,{recursive:true,force:true}));
 // The verified download and extraction are exercised elsewhere; here the source tree is
 // seeded directly so these tests pin the install shape and the verify decision.
 manager.installZip=async id=>{
  const dir=manager.versionFolder(id);
  await mkdir(dir,{recursive:true});
  return dir;
 };
 return {manager,dataDir,runtime};
}

// Lay down the extracted source archive the way extractVerifiedZip leaves it.
async function seedRepo(manager){
 const dir=manager.versionFolder('freellmapi');
 const repo=path.join(dir,REPO_NAME);
 for(const file of REPO_FILES){const full=path.join(repo,file);await mkdir(path.dirname(full),{recursive:true});await writeFile(full,'{}')}
 return {dir,repo};
}

function stubRun(manager,calls){
 manager.run=async(file,args,options)=>{
  calls.push({file,args,cwd:options?.cwd});
  // `npm run build` is what produces the artifact ready() would otherwise never see.
  if(args.includes('run')&&args.includes('build')){
   const dist=path.join(options.cwd,'dist');
   await mkdir(dist,{recursive:true});
   await writeFile(path.join(dist,'index.js'),'');
  }
  return {code:0};
 };
}

function stubStart(manager){
 manager.start=(id,file,args,options)=>{
  const child={id,file,args,options,exitCode:null};
  manager.children.set(id,child);
  return child;
 };
}

test('FreeLLMAPI opts out of the inherited ignore-scripts and gives npm a resolvable layout',async t=>{
 const {manager}=await fakeManager(t);
 const {repo}=await seedRepo(manager);
 const calls=[];
 stubRun(manager,calls);
 stubStart(manager);

 await manager.setupFreeLLMAPI(AbortSignal.timeout(20000),'http://127.0.0.1:19286/managed/community/v1');

 // The fix: this provider must not inherit the shared npmrc's ignore-scripts=true,
 // or better-sqlite3's install script never runs and the server dies on the binding.
 const npmrc=await readFile(path.join(repo,'.npmrc'),'utf8');
 assert.match(npmrc,/ignore-scripts=false/);
 assert.match(npmrc,/registry=https:\/\/registry\.npmjs\.org\//);

 // npm resolves itself as node_modules/npm relative to its own bin directory. Leaving
 // only the bare npm\ folder is what made `npm run build` die with MODULE_NOT_FOUND.
 assert.deepEqual(calls.map(c=>path.basename(c.args[0])),['npm-cli.js','npm-cli.js']);
 for(const call of calls){
  assert.ok(call.args[0].includes(path.join('node_modules','npm','bin','npm-cli.js')),
   'npm must be invoked from the resolvable layout, got '+call.args[0]);
 }
 // install and build ran exactly once each; the archive was not re-extracted over them.
 assert.deepEqual(calls.map(c=>c.args.slice(1,3).join(' ')),['install --no-audit','run build']);
});

test('FreeLLMAPI setup returns a usable connection while its catalogue is still empty',async t=>{
 const {manager}=await fakeManager(t);
 const {repo}=await seedRepo(manager);
 const calls=[];
 stubRun(manager,calls);
 stubStart(manager);
 const progress=[];
 manager.notify=p=>progress.push(p);

 const connection=await manager.setupFreeLLMAPI(AbortSignal.timeout(20000),'http://127.0.0.1:19286/managed/community/v1');

 // Before the fix this rejected with "did not accept its connection (401)" from verify().
 assert.equal(connection.config.proxyPreset,'freellmapi');
 assert.equal(connection.dashboard,'http://127.0.0.1:3001');
 assert.equal(connection.config.proxyUrl,'http://127.0.0.1:3001/v1');
 // It reports exactly what the user has to do next, rather than failing setup.
 assert.ok(progress.some(p=>/add the provider keys you want/.test(p.message||'')));
 assert.ok(progress.some(p=>/Still installing/.test(p.message||'')===false));
});

test('a fully installed FreeLLMAPI skips install and build entirely',async t=>{
 const {manager}=await fakeManager(t);
 const {repo}=await seedRepo(manager);
 const dist=path.join(repo,'server','dist');
 await mkdir(dist,{recursive:true});
 await writeFile(path.join(dist,'index.js'),'');
 const calls=[];
 stubRun(manager,calls);
 stubStart(manager);

 await manager.setupFreeLLMAPI(AbortSignal.timeout(20000),'http://127.0.0.1:19286/managed/community/v1');
 // The one-time build is cached on disk; re-running it would cost minutes every start.
 assert.deepEqual(calls,[]);
});

test('the generic setup flow verifies every managed provider except FreeLLMAPI',async t=>{
 const {manager}=await fakeManager(t);
 const verified=[];
 manager.verify=async connection=>{verified.push(connection.config.proxyPreset)};
 // setupFreeLLMAPI is stubbed so this pins the verify decision, not the install.
 manager.setupFreeLLMAPI=async()=>({config:{provider:'proxy',proxyPreset:'freellmapi',proxyUrl:'http://127.0.0.1:3001/v1',model:'',freeModels:[],routerFreeOnly:false},key:'',dashboard:'http://127.0.0.1:3001'});
 manager.setupNine=async()=>({config:{provider:'proxy',proxyPreset:'9router',proxyUrl:'http://127.0.0.1:55001/v1',model:'free',freeModels:['free'],routerFreeOnly:true},key:'k'});
 await manager.setup('freellmapi','community');
 assert.deepEqual(verified,[],'FreeLLMAPI must not be verified while it has no key');
 await manager.setup('9router','community');
 assert.deepEqual(verified,['9router'],'other routers must still be verified');
});

test('reconnecting FreeLLMAPI reuses its running process without unauthenticated catalogue verification',async t=>{
 const {manager}=await fakeManager(t);await seedRepo(manager);
 const calls=[];stubRun(manager,calls);stubStart(manager);
 let stopped=0;manager.stop=async()=>{stopped++};
 manager.verify=async()=>{throw Error('Must not call the key-gated catalogue during setup')};
 const first=await manager.setup('freellmapi','local');
 const child=manager.children.get('freellmapi');
 const again=await manager.setup('freellmapi','local');
 assert.equal(again,first);assert.equal(manager.children.get('freellmapi'),child);
 assert.equal(stopped,0);assert.equal(calls.length,2);assert.equal(first.config.routerEngine,'community');
});

test('FreeLLMAPI setup and restore preserve a same-endpoint user key and selected route',()=>{
 const config={provider:'proxy',proxyPreset:'freellmapi',proxyUrl:'http://127.0.0.1:19286/providers/freellmapi/v1',model:'groq/code',managed:true};
 const result={config:{...config,model:'',freeModels:[]},key:''};
 assert.equal(applyManagedConnection(config,result).model,'groq/code');
 assert.equal(managedConnectionCredential(config,result,'user-unified-key'),'user-unified-key');
 assert.equal(managedConnectionCredential({...config,proxyUrl:'http://127.0.0.1:4000/v1'},result,'unrelated-key'),'');
 assert.equal(applyManagedConnection({...config,proxyUrl:'http://127.0.0.1:4000/v1'},result).model,'');
});

test('FreeLLMAPI catalogue distinguishes ready, unconfigured, and exhausted routes',async()=>{
 const catalogue={data:[
  {id:'auto',available:true,name:'Automatic'},
  {id:'groq/ready',available:true,execution_status:'ready',context_window:128000},
  {id:'premium/coder',available:false,execution_status:'needsKey',unavailable_reason:'no_key'},
  {id:'groq/limited',available:true,execution_status:'exhausted'},
 ]};
 const models=freeLLMCatalogue(catalogue);
 assert.equal(models.find(m=>m.id==='groq/ready').contextLength,128000);
 assert.equal(models.find(m=>m.id==='premium/coder').available,false);
 assert.equal(models.find(m=>m.id==='groq/limited').available,false);
 assert.equal(selectCatalogueModel(models,'',{preferred:'auto'}),'auto');
 assert.throws(()=>selectCatalogueModel(models,'groq/limited'),/quota exhausted/i);
 assert.throws(()=>selectCatalogueModel(freeLLMCatalogue({data:[catalogue.data[0],catalogue.data[2]]})),/No models are ready/);
 const before=globalThis.fetch;
 globalThis.fetch=async()=>Response.json(catalogue);
 try{
  const config={proxyPreset:'freellmapi',proxyUrl:'http://127.0.0.1:3001/v1'};
  assert.deepEqual(await listProxyModels(config,'user-key'),models);
  assert.deepEqual(await discoverProxy(config,'user-key'),models);
  await assert.rejects(listProxyModels(config,''),/unified API key/);
 }finally{globalThis.fetch=before}
});

test('managed FreeLLMAPI forwards the user unified key, preserves errors, and supports router-owned model IDs',async t=>{
 const requests=[];
 const connection={config:{provider:'proxy',proxyPreset:'freellmapi',proxyUrl:'http://127.0.0.1:3001/v1',model:'',freeModels:[]},key:''};
 const server=await createLocalServer({webDir:os.tmpdir(),port:0,getManagedConnection:()=>connection,fetchImpl:async(url,options)=>{
  requests.push({url,options});
  if(options.headers.Authorization!=='Bearer test-unified-key')return Response.json({error:{message:'Invalid unified key'}},{status:401});
  if(url.endsWith('/models'))return Response.json({data:[{id:'groq/ready',available:true,execution_status:'ready'}]});
  return Response.json({choices:[{message:{content:'{"message":"Ready","actions":[],"done":true}'}}]},{headers:{'X-Routed-Via':'groq/ready','X-Fallback-Attempts':'1','Retry-After':'30'}});
 }});
 t.after(()=>server.close());
 const endpoint=managedClientConnection(connection,server.origin).config.proxyUrl;
 assert.equal((await fetch(endpoint+'/models')).status,401);assert.equal(requests.length,0);
 const wrong=await fetch(endpoint+'/models',{headers:{Authorization:'Bearer wrong-key'}});
 assert.equal(wrong.status,401);assert.match(await wrong.text(),/Invalid unified key/);
 const models=await fetch(endpoint+'/models',{headers:{Authorization:'Bearer test-unified-key'}});
 assert.equal(models.status,200);
 const result=await fetch(endpoint+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer test-unified-key','Content-Type':'application/json'},body:JSON.stringify({model:'auto:smart',messages:[{role:'user',content:'Write a small function'}],stream:false})});
 assert.equal(result.status,200);assert.equal(result.headers.get('x-routed-via'),'groq/ready');assert.equal(result.headers.get('x-fallback-attempts'),'1');assert.equal(result.headers.get('retry-after'),'30');
 assert.equal(requests.at(-1).options.headers['X-FreeLLM-Task-Type'],'code');
 assert.equal(JSON.parse(requests.at(-1).options.body).model,'auto:smart');assert.equal(connection.key,'');
 const crossOrigin=await fetch(endpoint+'/models',{headers:{Origin:'https://other.example',Authorization:'Bearer test-unified-key'}});
 assert.equal(crossOrigin.status,403);
});

test('FreeLLMAPI coding turns carry the task hint and expose provider failover',async()=>{
 const previous=globalThis.fetch,status=[];
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'http://127.0.0.1:3001/v1/chat/completions');
  assert.equal(options.headers['X-FreeLLM-Task-Type'],'code');assert.equal(options.headers.Authorization,'Bearer test-unified-key');
  return Response.json({choices:[{message:{content:'{"message":"Done","actions":[],"done":true}'}}]},{headers:{'X-Routed-Via':'groq/ready','X-Fallback-Attempts':'1'}});
 };
 try{
  const reply=await complete([{role:'user',content:'Plan a page'}],{...defaultConfig,provider:'proxy',proxyPreset:'freellmapi',proxyUrl:'http://127.0.0.1:3001/v1',model:'auto',resilience:false},'test-unified-key',new AbortController().signal,()=>{},message=>status.push(message));
  assert.match(reply,/Done/);assert.ok(status.some(message=>/groq\/ready after provider failover/.test(message)));
 }finally{globalThis.fetch=previous}
});

test('managed FreeLLMAPI chooses a private port instead of taking over an existing service',async t=>{
 const occupied=net.createServer();await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>occupied.close(resolve)));
 const preferred=occupied.address().port;
 assert.notEqual(await freePort(preferred),preferred);
 assert.equal(occupied.listening,true);
});

test('the real provider installer launches its Node child without an undefined options reference',async t=>{
 const {manager}=await fakeManager(t);
 await manager.run(process.execPath,['-e','process.stdout.write("installer launched")'],{signal:AbortSignal.timeout(5000),timeout:5000});
 await assert.rejects(manager.run(process.execPath,['-e','process.exit(1)'],{timeout:5000}),/Provider installation did not finish/);
});
