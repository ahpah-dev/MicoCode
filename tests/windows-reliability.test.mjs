import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {ProviderManager} from '../desktop/provider-manager.mjs';
import {createLocalServer} from '../desktop/server.mjs';
import {listProxyModels} from '../lib/mico/providers.mjs';

const connection=()=>({config:{provider:'proxy',proxyPreset:'9router',proxyUrl:'http://127.0.0.1:55001/v1',model:'mico-free/free-code',freeModels:['mico-free/free-code'],routerEngine:'community'},key:'test-client'});
const brokenBody=()=>new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"choices":['));queueMicrotask(()=>controller.error(new TypeError('Router disconnected while responding')))}});

test('a router disconnect after response headers returns a usable connection error',async()=>{
 const server=await createLocalServer({webDir:os.tmpdir(),port:0,getManagedConnection:connection,fetchImpl:async()=>new Response(brokenBody(),{status:200,headers:{'Content-Type':'application/json'}})});
 try{
  const response=await fetch(server.origin+'/providers/9router/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer test-client','Content-Type':'application/json'},body:JSON.stringify({model:'mico-free/free-code',messages:[{role:'user',content:'Build a page'}]})});
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/router stopped responding.*Set up & connect/);
 }finally{await server.close()}
});

test('direct managed Ollama uses bounded injected transport and reports response disconnects',async()=>{
 let forwarded;
 const server=await createLocalServer({webDir:os.tmpdir(),port:0,getOllamaUpstream:()=> 'http://127.0.0.1:55002',fetchImpl:async(url,options)=>{forwarded={url,options};return new Response(brokenBody(),{status:200})}});
 try{
  const response=await fetch(server.origin+'/managed/ollama/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'coder',messages:[{role:'user',content:'Hi'}]})});
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/local coding engine stopped responding/);
  assert.equal(forwarded.url,'http://127.0.0.1:55002/api/chat');
  assert.ok(forwarded.options.signal instanceof AbortSignal);
 }finally{await server.close()}
});

test('an oversized router reply is cancelled without forwarding partial model output',async()=>{
 let cancelled=false,read=0;
 const body=new ReadableStream({pull(controller){read++;controller.enqueue(new Uint8Array(1024*1024))},cancel(){cancelled=true}});
 const server=await createLocalServer({webDir:os.tmpdir(),port:0,getManagedConnection:connection,fetchImpl:async()=>new Response(body)});
 try{
  const response=await fetch(server.origin+'/providers/9router/v1/models',{headers:{Authorization:'Bearer test-client'}});
  assert.equal(response.status,502);assert.match((await response.json()).error,/response was too large/);
  assert.equal(cancelled,true);assert.ok(read<=18);
 }finally{await server.close()}
});

test('reconnect replaces an unhealthy cached private router instead of retaining its failure',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'mico-repair-'));
 const manager=new ProviderManager({dataDir:dir,runtimeDir:dir,gatewayBase:'http://127.0.0.1:19286/managed/v1',gatewayKey:'internal',vault:{}});
 const stale=connection(),fresh=connection();let stopped=0,verified=0;
 manager.children.set('9router',{exitCode:null});manager.connections.set('9router',stale);
 manager.stop=async id=>{stopped++;manager.children.delete(id);manager.connections.delete(id)};
 manager.verify=async candidate=>{verified++;if(candidate===stale)throw new TypeError('fetch failed')};
 manager.setupNine=async()=>{manager.children.set('9router',{exitCode:null});return fresh};
 try{
  assert.equal(await manager.setup('9router','community'),fresh);
  assert.equal(manager.connections.get('9router'),fresh);
  assert.equal(stopped,1);assert.equal(verified,2);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('a private provider spawn failure cannot remain marked running or connected',async()=>{
 const manager=new ProviderManager({dataDir:os.tmpdir(),runtimeDir:os.tmpdir(),gatewayBase:'http://127.0.0.1:19286/managed/v1',gatewayKey:'internal',vault:{}});
 manager.connections.set('9router',connection());
 const child=manager.start('9router',path.join(os.tmpdir(),'mico-missing-'+Date.now()+'.exe'),[]);
 await once(child,'error');
 assert.equal(manager.children.has('9router'),false);
 assert.equal(manager.connections.has('9router'),false);
 assert.equal((await manager.statuses()).find(s=>s.provider==='9router').running,false);
});

test('a stopped private provider drops its stale protected connection',async()=>{
 const manager=new ProviderManager({dataDir:os.tmpdir(),runtimeDir:os.tmpdir(),gatewayBase:'http://127.0.0.1:19286/managed/v1',gatewayKey:'internal',vault:{}});
 manager.connections.set('9router',connection());
 const child=manager.start('9router',process.execPath,['-e','process.exit(0)']);
 await once(child,'exit');
 assert.equal(manager.children.has('9router'),false);
 assert.equal(manager.connections.has('9router'),false);
});

test('managed 9Router fills only missing connected OpenCode free-model selections',async()=>{
 const rows=[
  {id:'missing',provider:'opencode',isActive:true,providerSpecificData:{headers:{'x-existing':'preserved'}}},
  {id:'empty',provider:'opencode-zen',isActive:true,providerSpecificData:{enabledModels:[]}},
  {id:'explicit',provider:'opencode',isActive:true,providerSpecificData:{enabledModels:['chosen-by-user']}},
  {id:'disabled',provider:'opencode',isActive:false},
  {id:'unrelated',provider:'other',isActive:true},
  {id:'malformed',provider:'opencode',isActive:true,providerSpecificData:{enabledModels:'leave-nonempty-settings-alone'}},
 ];
 const writes=[];let discoveries=0;
 const manager=new ProviderManager({dataDir:os.tmpdir(),runtimeDir:os.tmpdir(),gatewayBase:'http://127.0.0.1:19286/managed/v1',gatewayKey:'internal',vault:{},loadOpenCodeModelsImpl:async()=>{discoveries++;return [{id:'live-free-coder',verified:true,paid:false},{id:'retired-or-unknown',verified:false,paid:false},{id:'paid-model',verified:true,paid:true},{id:'live-free-coder',verified:true,paid:false}]},fetchImpl:async(url,options)=>{
  assert.equal(options.headers.Cookie,'session=private');
  if(options.method==='GET'){
   if(url.endsWith('/api/keys'))return Response.json({keys:[{key:'test-client'}]});
   if(url.includes('/api/models/disabled?providerAlias=oc'))return Response.json({ids:[]});
   assert.equal(url,'http://127.0.0.1:55001/api/providers');return Response.json({connections:rows});
  }
  assert.equal(options.method,'PUT');const id=url.split('/').at(-1),body=JSON.parse(options.body);writes.push({id,body});const row=rows.find(r=>r.id===id);row.providerSpecificData={...row.providerSpecificData,...body.providerSpecificData};return Response.json({connection:row});
 }});
 manager.cookies.set('9router','session=private');const live={...connection(),dashboard:'http://127.0.0.1:55001/dashboard'};
 const result=await manager.syncOpenCodeCatalogue(live,new AbortController().signal);
 assert.equal(result.updated,2);assert.deepEqual(result.models,['live-free-coder']);assert.equal(discoveries,1);
 assert.deepEqual(writes.map(w=>w.id),['missing','empty']);
 assert.deepEqual(writes[0].body,{providerSpecificData:{enabledModels:['live-free-coder'],micoFreeCatalogue:['live-free-coder']}});
 assert.deepEqual(rows[0].providerSpecificData.headers,{'x-existing':'preserved'});
 assert.deepEqual(rows[2].providerSpecificData.enabledModels,['chosen-by-user']);
 assert.equal((await manager.syncOpenCodeCatalogue(live,new AbortController().signal)).updated,0);assert.equal(discoveries,2);assert.equal(writes.length,2);
});

test('optional OpenCode discovery failure preserves a working managed router and reports a warning',async()=>{
 const progress=[];let wrote=false;
 const manager=new ProviderManager({dataDir:os.tmpdir(),runtimeDir:os.tmpdir(),gatewayBase:'http://127.0.0.1:19286/managed/v1',gatewayKey:'internal',vault:{},onProgress:p=>progress.push(p),loadOpenCodeModelsImpl:async()=>{throw new TypeError('Discovery offline')},fetchImpl:async(url,options)=>{
  if(url.endsWith('/api/providers'))return Response.json({connections:[{id:'connected',provider:'opencode',isActive:true}]});
  if(url.endsWith('/api/keys'))return Response.json({keys:[{key:'test-client'}]});
  if(url.includes('/api/models/disabled?providerAlias=oc'))return Response.json({ids:[]});
  if(options.method==='PUT')wrote=true;
  return Response.json({data:[{id:'mico-free/free-code'}]});
 }});
 manager.cookies.set('9router','session=private');const live={...connection(),dashboard:'http://127.0.0.1:55001/dashboard'};manager.connections.set('9router',live);
 assert.equal(await manager.refreshNineCatalogue(),live);assert.equal(wrote,false);
 assert.match(live.catalogueWarning,/Existing router models remain available/);
 assert.equal(progress.at(-1).stage,'warning');assert.deepEqual(live.config.routerModels,['mico-free/free-code']);
});

test('OpenCode model sync never sends the private dashboard cookie to a remote or different origin',async()=>{
 let requested=false;
 const manager=new ProviderManager({dataDir:os.tmpdir(),runtimeDir:os.tmpdir(),gatewayBase:'http://127.0.0.1:19286/managed/v1',gatewayKey:'internal',vault:{},fetchImpl:async()=>{requested=true;throw new Error('Must not request')}});
 manager.cookies.set('9router','session=private');
 for(const dashboard of ['https://remote.example/dashboard','http://127.0.0.1:55002/dashboard']){
  const result=await manager.syncOpenCodeCatalogue({...connection(),dashboard});assert.ok(result.warning);
 }
 assert.equal(requested,false);
});

test('cached static router models cannot hide a stopped or changed local coding engine',async()=>{
 for(const tags of [null,{models:[{name:'different-coder'}]}]){
  const dir=await mkdtemp(path.join(os.tmpdir(),'mico-engine-repair-'));let tagsChecked=0,engineSetups=0;const stopped=[];
  const manager=new ProviderManager({dataDir:dir,runtimeDir:dir,gatewayBase:'http://127.0.0.1:19286/managed/v1',gatewayKey:'internal',vault:{},fetchImpl:async(url,options)=>{tagsChecked++;assert.equal(url,'http://127.0.0.1:11434/api/tags');assert.ok(options.signal instanceof AbortSignal);if(!tags)throw new TypeError('Ollama stopped');return Response.json(tags)}});
  const stale=connection(),fresh=connection();stale.config.routerEngine=fresh.config.routerEngine='local';
  manager.ollamaUpstream='http://127.0.0.1:11434';manager.ollamaModel='coder';manager.ollamaModels=[{name:'coder',route:'free-code'}];
  manager.children.set('9router',{exitCode:null});manager.connections.set('9router',stale);
  manager.stop=async id=>{stopped.push(id);manager.children.delete(id);manager.connections.delete(id)};
  manager.verify=async()=>{};
  manager.setupOllama=async()=>{engineSetups++;return {config:{provider:'ollama',ollamaUrl:'http://127.0.0.1:19286/managed/ollama',model:'coder'},key:''}};
  manager.setupNine=async()=>{manager.children.set('9router',{exitCode:null});return fresh};
  try{
   await mkdir(manager.folder('ollama'),{recursive:true});
   assert.equal(await manager.setup('9router','local'),fresh);
   assert.equal(tagsChecked,1);assert.equal(engineSetups,1);assert.deepEqual(stopped,['9router']);
  }finally{await rm(dir,{recursive:true,force:true})}
 }
});

test('automatic OpenCode lists refresh availability while preserving user-changed selections',async()=>{
 const rows=[
  {id:'auto',provider:'opencode',isActive:true,providerSpecificData:{enabledModels:['retired-free','now-paid'],micoFreeCatalogue:['retired-free','now-paid']}},
  {id:'changed',provider:'opencode',isActive:true,providerSpecificData:{enabledModels:['user-choice'],micoFreeCatalogue:['previous-free']}},
  {id:'cleared-by-user',provider:'opencode',isActive:true,providerSpecificData:{enabledModels:[],micoFreeCatalogue:['previous-free']}},
 ];
 let catalogue=[{id:'new-free',verified:true,paid:false},{id:'now-paid',verified:true,paid:true}];const writes=[];
 const manager=new ProviderManager({dataDir:os.tmpdir(),runtimeDir:os.tmpdir(),gatewayBase:'http://127.0.0.1:19286/managed/v1',gatewayKey:'internal',vault:{},loadOpenCodeModelsImpl:async()=>catalogue,fetchImpl:async(url,options)=>{
  if(options.method==='GET'){
   if(url.endsWith('/api/keys'))return Response.json({keys:[{key:'test-client'}]});
   if(url.includes('/api/models/disabled?providerAlias=oc'))return Response.json({ids:[]});
   return Response.json({connections:rows});
  }
  const id=url.split('/').at(-1),body=JSON.parse(options.body);writes.push(id);Object.assign(rows.find(r=>r.id===id).providerSpecificData,body.providerSpecificData);return Response.json({});
 }});
 manager.cookies.set('9router','session=private');const live={...connection(),dashboard:'http://127.0.0.1:55001/dashboard'};
 let result=await manager.syncOpenCodeCatalogue(live);
 assert.equal(result.updated,1);assert.deepEqual(rows[0].providerSpecificData.enabledModels,['new-free']);assert.deepEqual(rows[0].providerSpecificData.micoFreeCatalogue,['new-free']);
 assert.deepEqual(rows[1].providerSpecificData.enabledModels,['user-choice']);assert.deepEqual(rows[2].providerSpecificData.enabledModels,[]);assert.deepEqual(writes,['auto']);
 catalogue=[];result=await manager.syncOpenCodeCatalogue(live);
 assert.equal(result.updated,1);assert.ok(result.warning);assert.deepEqual(rows[0].providerSpecificData.enabledModels,[]);assert.deepEqual(rows[1].providerSpecificData.enabledModels,['user-choice']);assert.deepEqual(writes,['auto','auto']);
 catalogue=[{id:'next-free',verified:true,paid:false}];result=await manager.syncOpenCodeCatalogue(live);
 assert.equal(result.updated,1);assert.deepEqual(rows[0].providerSpecificData.enabledModels,['next-free']);assert.deepEqual(rows[2].providerSpecificData.enabledModels,[]);
});

test('managed 9Router does not advertise OpenCode models without an active provider connection',async()=>{
 const live={...connection(),dashboard:'http://127.0.0.1:55001/dashboard'};let discoveries=0;
 const upstream=async(url,options)=>{
  if(url.endsWith('/api/providers'))return Response.json({connections:[]});
  if(url.endsWith('/api/keys'))return Response.json({keys:[{key:'test-client'}]});
  if(url.includes('/api/models/disabled?providerAlias=oc'))return Response.json({ids:[]});
  if(url.endsWith('/v1/models'))return Response.json({data:[{id:'mico-free/free-code'}]});
  return Response.json({choices:[{message:{content:'{"message":"Local route reached"}'}}]});
 };
 const server=await createLocalServer({webDir:os.tmpdir(),port:0,getManagedConnection:()=>live,fetchImpl:upstream});
 const manager=new ProviderManager({dataDir:os.tmpdir(),runtimeDir:os.tmpdir(),gatewayBase:server.origin+'/managed/v1',gatewayKey:'internal',vault:{},fetchImpl:upstream,loadOpenCodeModelsImpl:async()=>{discoveries++;return [{id:'live-free',name:'Live Free Coder',verified:true,paid:false}]}});
 manager.cookies.set('9router','session=private');manager.connections.set('9router',live);
 try{
  assert.equal(await manager.refreshNineCatalogue(),live);
  assert.deepEqual(live.config.routerModels,['mico-free/free-code']);assert.deepEqual(live.openCodeFreeModels,[]);assert.equal(discoveries,0);
  const config={...live.config,proxyUrl:server.origin+'/providers/9router/v1',managed:true};
  const catalogue=await listProxyModels(config,live.key,AbortSignal.timeout(5000));
  assert.deepEqual(catalogue.map(m=>m.id),['mico-free/free-code']);
  const raw=await (await fetch(config.proxyUrl+'/models',{headers:{Authorization:'Bearer '+live.key}})).json();
  assert.deepEqual(raw.data.map(m=>m.id),['mico-free/free-code']);
 }finally{await server.close()}
});

test('public OpenCode supplementation respects disabled routes and the exact managed key policy',async()=>{
 const models=['allowed','disabled','outside'].map(id=>({id,verified:true,paid:false}));
 const policies=[
  {key:'test-client',allowedModels:['mico-free/free-code','oc/allowed','oc/disabled'],expected:['oc/allowed']},
  {key:'test-client',allowedModels:[],expected:['oc/allowed','oc/outside']},
  {key:'test-client',isActive:false,expected:[]},
  {key:'different-client',expected:[]},
  {key:'test-client',allowedModels:'unknown-policy',expected:[]},
 ];
 for(const policy of policies){
  const manager=new ProviderManager({dataDir:os.tmpdir(),runtimeDir:os.tmpdir(),gatewayBase:'http://127.0.0.1:19286/managed/v1',gatewayKey:'internal',vault:{},loadOpenCodeModelsImpl:async()=>models,fetchImpl:async url=>{
   if(url.endsWith('/api/providers'))return Response.json({connections:[{id:'opencode-account',provider:'opencode',isActive:true,providerSpecificData:{enabledModels:[]}}]});
   if(url.endsWith('/api/keys'))return Response.json({keys:[policy]});
   return Response.json({ids:['disabled']});
  }});
  manager.cookies.set('9router','session=private');const live={...connection(),dashboard:'http://127.0.0.1:55001/dashboard'};
  await manager.syncOpenCodeCatalogue(live);assert.deepEqual(live.openCodeFreeModels.map(m=>m.id),policy.expected);
 }
});

test('failed public OpenCode discovery keeps base routes and removes unverified supplemental rows',async()=>{
 const live={...connection(),dashboard:'http://127.0.0.1:55001/dashboard',openCodeFreeModels:[{id:'oc/old-live',catalogueSource:'opencode-live',pricing:{prompt:'0',completion:'0'}}]};
 const manager=new ProviderManager({dataDir:os.tmpdir(),runtimeDir:os.tmpdir(),gatewayBase:'http://127.0.0.1:19286/managed/v1',gatewayKey:'internal',vault:{},loadOpenCodeModelsImpl:async()=>{throw new TypeError('Official discovery offline')},fetchImpl:async url=>{
  if(url.endsWith('/api/providers'))return Response.json({connections:[{id:'opencode-account',provider:'opencode',isActive:true,providerSpecificData:{enabledModels:[]}}]});
  if(url.endsWith('/api/keys'))return Response.json({keys:[{key:'test-client'}]});
  if(url.includes('/api/models/disabled?providerAlias=oc'))return Response.json({ids:[]});
  return Response.json({data:[{id:'mico-free/free-code'}]});
 }});
 manager.cookies.set('9router','session=private');manager.connections.set('9router',live);
 assert.equal(await manager.refreshNineCatalogue(),live);assert.match(live.catalogueWarning,/discovery could not refresh/);assert.deepEqual(live.openCodeFreeModels,[]);assert.deepEqual(live.config.routerModels,['mico-free/free-code']);
});
