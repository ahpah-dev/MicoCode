import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import JSZip from 'jszip';
import {archivePath,extractVerifiedZip,downloadVerified} from '../desktop/install.mjs';
import {assertProvider,assertEngine,cliProxyConfig,liteLLMConfig,managedProviders,ProviderManager} from '../desktop/provider-manager.mjs';
import {artifacts,versions} from '../desktop/artifacts.mjs';
import {isLocalRequest,createLocalServer,managedClientConnection} from '../desktop/server.mjs';
import {applyManagedConnection,discoverProxy,listProxyModels,managedPresets,proxyPresets} from '../lib/mico/providers.mjs';
import {actionSchema} from '../lib/mico/action-schema.mjs';

test('provider automation only accepts supported installer IDs',()=>{for(const id of ['9router','cliproxy','litellm','freeride','ollama'])assert.equal(assertProvider(id),id);for(const id of ['../ollama','custom','powershell','9router;whoami','gptload','octopus',null])assert.throws(()=>assertProvider(id))});

// Only the most recent router used to come back, so a second one the user had set
// up looked broken after a restart.
// The workspace saved "LiteLLM is my router" while the manager's last-provider
// record said CLIProxyAPI. Restoring only the latter left LiteLLM down, and the
// workspace then dialled its loopback port directly — which the browser reports as
// a CORS failure, not as a stopped router.
test('restore prefers the router the workspace has selected over the one used last',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'mico-restore-'));
 const manager=new ProviderManager({dataDir:dir,runtimeDir:dir,gatewayBase:'http://127.0.0.1:1/managed/v1',gatewayKey:'gateway',vault:{get:async()=>null,set:async()=>{}}});
 const chosen=[];
 manager.setup=async(id,engine)=>{chosen.push([id,engine]);return {config:{provider:'proxy',proxyPreset:id,proxyUrl:'http://127.0.0.1:1/v1',model:'m'},key:'k'}};
 try{
  for(const id of ['cliproxy','litellm'])await mkdir(path.join(dir,'providers',id),{recursive:true});
  await writeFile(path.join(dir,'providers','cliproxy','installed.json'),'{"version":"1"}');
  await writeFile(path.join(dir,'providers','litellm','installed.json'),'{"version":"1.104.2"}');
  await writeFile(path.join(dir,'providers','last-provider.json'),JSON.stringify({provider:'cliproxy',engine:'community'}));
  assert.ok(await manager.restore('litellm','community'),'the selected router is restored');
  assert.deepEqual(chosen,[['litellm','community']],'the workspace selection wins over the last-used router');
  chosen.length=0;
  await manager.restore(undefined,'community');
  assert.deepEqual(chosen,[['cliproxy','community']],'with nothing selected it falls back to the last-used router');
  chosen.length=0;
  // A selected router that was never installed falls back instead of failing setup.
  await rm(path.join(dir,'providers','litellm','installed.json'),{force:true});
  await manager.restore('litellm','community');
  assert.deepEqual(chosen,[['cliproxy','community']],'an uninstalled selection falls back to the last-used router');
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('every router the user set up is remembered and can be brought back',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'mico-routers-'));
 const manager=new ProviderManager({dataDir:dir,runtimeDir:dir,gatewayBase:'http://127.0.0.1:1/managed/v1',gatewayKey:'gateway',vault:{get:async()=>null,set:async()=>{}}});
 try{
  assert.deepEqual(await manager.connectedRouters(),[],'a fresh install remembers nothing');
  await manager.rememberRouter('litellm','community');
  await manager.rememberRouter('freeride','community');
  assert.deepEqual(await manager.connectedRouters(),[{provider:'litellm',engine:'community'},{provider:'freeride',engine:'community'}],'both routers are remembered, most recent last');
  // Re-remembering replaces the entry instead of duplicating it.
  await manager.rememberRouter('litellm','local');
  assert.deepEqual(await manager.connectedRouters(),[{provider:'freeride',engine:'community'},{provider:'litellm',engine:'local'}],'a router is stored once, with its latest engine');
  // Names that are not managed routers are ignored rather than acted on.
  await writeFile(path.join(dir,'providers','connected.json'),JSON.stringify([{provider:'evil',engine:'community'},{provider:'freeride',engine:'community'}]));
  assert.deepEqual((await manager.connectedRouters()).map(entry=>entry.provider),['freeride']);
  // Nothing is started for a router whose package is not installed.
  assert.deepEqual(await manager.restoreOthers(),[]);
  // A router installed by an older build was never recorded, so it is found on
  // disk instead. Missing this is what left a configured router switched off and
  // reporting "Your managed router is stopped" on every request to it.
  await rm(path.join(dir,'providers','connected.json'),{force:true});
  await mkdir(path.join(dir,'providers','freeride'),{recursive:true});
  await writeFile(path.join(dir,'providers','freeride','installed.json'),JSON.stringify({version:'0.4.0a24'}));
  await writeFile(path.join(dir,'providers','last-provider.json'),JSON.stringify({provider:'9router',engine:'community'}));
  assert.deepEqual(await manager.connectedRouters(),[{provider:'freeride',engine:'community'}],'an installed router is remembered even with no record of it');
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('managed engines cannot be changed to paid or arbitrary destinations',()=>{assert.equal(assertEngine('local'),'local');assert.equal(assertEngine('community'),'community');for(const value of ['paid','https://other.example','custom',null])assert.throws(()=>assertEngine(value))});
test('provider archives cannot escape, create links, or overwrite a destination',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mico-archive-'));
 try{
  for(const name of ['../bad','/outside','C:/outside','folder/../../bad','folder\\bad','a/./bad','bad\0file'])assert.throws(()=>archivePath(root,name));
  const zip=new JSZip();zip.file('folder/working.txt','verified');const file=path.join(root,'test.zip');await writeFile(file,await zip.generateAsync({type:'nodebuffer'}));
  const out=path.join(root,'out');await extractVerifiedZip(file,out);assert.equal(await readFile(path.join(out,'folder','working.txt'),'utf8'),'verified');await assert.rejects(extractVerifiedZip(file,out),/already exists/);
  const link=new JSZip();link.file('link','../outside',{unixPermissions:0o120777});const bad=path.join(root,'link.zip');await writeFile(bad,await link.generateAsync({type:'nodebuffer',platform:'UNIX'}));await assert.rejects(extractVerifiedZip(bad,path.join(root,'bad')),/Links and special files/);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('private router configs expose every managed route on loopback',()=>{
 const routes=['deepseek-r1-8b','llama3-1-8b'];
 const cli=cliProxyConfig(30001,'sk-client','http://127.0.0.1:19286/managed/v1','sk-internal','C:\\Mico\\auth',routes);
 const lite=liteLLMConfig(30002,'sk-client','http://127.0.0.1:19286/managed/v1','sk-internal',routes);
 assert.match(cli,/host: 127\.0\.0\.1/);assert.match(cli,/allow-remote: false/);assert.match(cli,/disable-control-panel: true/);
 for(const id of routes){assert.match(cli,new RegExp('alias: "'+id+'"'));assert.match(lite,new RegExp('model_name: "'+id+'"'));assert.match(lite,new RegExp('model: "openai/'+id+'"'))}
 assert.match(cliProxyConfig(30001,'k','b','u','C:\\a'),/alias: "free-code"/);
 assert.doesNotMatch(cli+lite,/openrouter\.ai|antigravity-credits: true|claude|paid/);
});
test('native server rejects hostile hosts and origins and protects the managed gateway',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mico-web-'));await writeFile(path.join(root,'index.html'),'<h1>Local workspace</h1>');const server=await createLocalServer({webDir:root,port:0,gatewayKey:'private'});
 try{
  assert.equal((await fetch(server.origin)).status,200);
  assert.equal((await fetch(server.origin,{headers:{Origin:'https://other.example'}})).status,403);
  assert.equal((await fetch(server.origin+'/managed/v1/models')).status,401);
  assert.equal((await fetch(server.origin+'/managed/ollama/api/chat',{method:'POST',body:'{}'})).status,503);
  assert.equal((await fetch(server.origin+'/managed/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer private','Content-Type':'application/json'},body:JSON.stringify({model:'paid-model',messages:[]})})).status,400);
  assert.equal(isLocalRequest(new Request(server.origin,{headers:{'sec-fetch-site':'cross-site'}}),server.origin),false);
 }finally{await server.close();await rm(root,{recursive:true,force:true})}
});
test('cancelled setup does not begin a download',async()=>{const abort=new AbortController();abort.abort();await assert.rejects(downloadVerified({url:'https://example.com/file.zip',sha256:'0'.repeat(64),maxBytes:1},path.join(os.tmpdir(),'mico-cancel-test.zip'),abort.signal),/abort/i)});

test('managed renderer transport reaches its real router without requiring upstream CORS',async()=>{
 const connection={config:{provider:'proxy',proxyPreset:'9router',proxyUrl:'http://127.0.0.1:55001/v1',model:'mico-free/free-code'},key:'private-client'};let sent;let calls=0;
  const server=await createLocalServer({webDir:os.tmpdir(),port:0,gatewayKey:'internal',getManagedConnection:id=>id==='9router'?connection:null,fetchImpl:async(url,options)=>{calls++;sent={url,options};if(JSON.parse(options.body).model==='paid-model')return Response.json({error:'Model not found by router'},{status:400});return Response.json({error:{message:'Daily free quota exhausted'}},{status:429,headers:{'Retry-After':'120'}})}});
 try{
  const exposed=managedClientConnection(connection,server.origin);assert.equal(exposed.config.proxyUrl,server.origin+'/providers/9router/v1');assert.equal(connection.config.proxyUrl,'http://127.0.0.1:55001/v1');
  const endpoint=exposed.config.proxyUrl+'/chat/completions';const headers={Authorization:'Bearer private-client','Content-Type':'application/json',Origin:server.origin};
  const body={model:connection.config.model,messages:[{role:'user',content:'A coding task'}],max_tokens:30,stream:true,url:'https://paid.example'};
  const r=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'120');assert.equal((await r.json()).error.message,'Daily free quota exhausted');
  assert.equal(sent.url,'http://127.0.0.1:55001/v1/chat/completions');assert.equal(sent.options.redirect,'error');assert.equal(sent.options.headers.Authorization,'Bearer private-client');assert.equal(JSON.parse(sent.options.body).stream,false);assert.equal(JSON.parse(sent.options.body).url,undefined);
  assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({...body,model:'paid-model'})})).status,400);
  assert.equal((await fetch(endpoint,{method:'POST',headers:{...headers,Origin:'https://other.example'},body:JSON.stringify(body)})).status,403);
  assert.equal((await fetch(endpoint,{method:'POST',headers:{...headers,Authorization:'Bearer other'},body:JSON.stringify(body)})).status,401);
   assert.equal((await fetch(endpoint)).status,401);assert.equal(calls,2);
 }finally{await server.close()}
});

// The renderer only ever reaches a managed router through this route. When the
// route is matched against a hand-written list, every request to a router that is
// missing from it 404s while the router itself is perfectly healthy.
test('every registered managed router is reachable through the app proxy route',async()=>{
 const server=await createLocalServer({webDir:os.tmpdir(),port:0,gatewayKey:'internal',
  getManagedConnection:id=>({key:'private-client',config:{provider:'proxy',proxyPreset:id,proxyUrl:'http://127.0.0.1:55001/v1',model:'free-code',freeModels:['free-code']}}),
  fetchImpl:async()=>Response.json({object:'list',data:[{id:'free-code',object:'model'}]})});
 try{
  for(const id of managedPresets){
   const r=await fetch(server.origin+'/providers/'+id+'/v1/models',{headers:{Authorization:'Bearer private-client',Origin:server.origin}});
   assert.equal(r.status,200,id+' must be reachable through the app proxy, not a hand-written subset of routers');
  }
  const unknown=await fetch(server.origin+'/providers/evil/v1/models',{headers:{Authorization:'Bearer private-client',Origin:server.origin}});
  assert.equal(unknown.status,404,'an unregistered router id must still be refused');
 }finally{await server.close()}
});

test('stopped and invalid managed routers return readable errors without arbitrary forwarding',async()=>{
 let connection=null;let failure=new TypeError('Connection refused');let calls=0;
 const server=await createLocalServer({webDir:os.tmpdir(),port:0,getManagedConnection:()=>connection,fetchImpl:async()=>{calls++;throw failure}});
 try{
  const url=server.origin+'/providers/9router/v1/models',options={headers:{Authorization:'Bearer private'}};
  let r=await fetch(url,options);assert.equal(r.status,503);assert.match((await r.json()).error,/Set up & connect/);
  connection={key:'private',config:{proxyUrl:'https://remote.example/v1'}};assert.equal((await fetch(url,options)).status,503);assert.equal(calls,0);
  connection.config.proxyUrl='http://127.0.0.1:55001/v1';r=await fetch(url,options);assert.equal(r.status,503);assert.match((await r.json()).error,/Set up & connect/);
  failure=new DOMException('Expired','TimeoutError');r=await fetch(url,options);assert.equal(r.status,504);assert.match((await r.json()).error,/smaller local model/);
 }finally{await server.close()}
});

test('managed renderer transport accepts any configured free model',async()=>{
 const connection={config:{provider:'proxy',proxyPreset:'cliproxy',proxyUrl:'http://127.0.0.1:55002/v1',model:'deepseek-r1-8b',freeModels:['deepseek-r1-8b','llama3-1-8b']},key:'private-client'};
 const server=await createLocalServer({webDir:os.tmpdir(),port:0,gatewayKey:'internal',getManagedConnection:()=>connection,fetchImpl:async()=>Response.json({choices:[{message:{content:'{}'}}]})});
 try{
  const endpoint=server.origin+'/providers/cliproxy/v1/chat/completions';const headers={Authorization:'Bearer private-client','Content-Type':'application/json',Origin:server.origin};
  const body={model:'llama3-1-8b',messages:[{role:'user',content:'Hi'}]};
  assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body)})).status,200);
  assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({...body,model:'paid-model'})})).status,400);
 }finally{await server.close()}
});

test('managed FreeRide exposes its cross-provider auto route through the protected relay',async()=>{
 const connection={config:{provider:'proxy',proxyPreset:'freeride',proxyUrl:'http://127.0.0.1:11343/v1',model:'freeride/auto',freeModels:['freeride/auto','nvidia_nim/nemotron'],routerFreeOnly:true,managed:true,routerEngine:'community'},key:'any'};let forwarded;
 const server=await createLocalServer({webDir:os.tmpdir(),port:0,getManagedConnection:id=>id==='freeride'?connection:null,fetchImpl:async(url,options)=>{
  if(url.endsWith('/models'))return Response.json({data:[{id:'nvidia_nim/nemotron',owned_by:'nvidia_nim'}]});
  forwarded={url,options};return Response.json({choices:[{message:{content:'FreeRide fallback worked'}}]});
 }});
 try{
  const exposed=managedClientConnection(connection,server.origin);assert.equal(exposed.config.proxyUrl,server.origin+'/providers/freeride/v1');
  const headers={Authorization:'Bearer any','Content-Type':'application/json',Origin:server.origin};
  const catalogue=await fetch(exposed.config.proxyUrl+'/models',{headers});assert.deepEqual((await catalogue.json()).data.map(m=>m.id),['nvidia_nim/nemotron','freeride/auto']);
  const response=await fetch(exposed.config.proxyUrl+'/chat/completions',{method:'POST',headers,body:JSON.stringify({model:'freeride/auto',messages:[{role:'user',content:'Make a small fix'}]})});
  assert.equal(response.status,200);assert.equal(forwarded.url,'http://127.0.0.1:11343/v1/chat/completions');assert.equal(JSON.parse(forwarded.options.body).model,'freeride/auto');
 }finally{await server.close()}
});

test('managed 9Router discovery, restore, refresh, and chat include all connected providers',async()=>{
 const connection={config:{provider:'proxy',proxyPreset:'9router',proxyUrl:'http://127.0.0.1:55001/v1',model:'mico-free/free-code',freeModels:['mico-free/free-code'],routerFreeOnly:true,managed:true,routerEngine:'local'},key:'private-client'};
 let catalogue=[
  {id:'mico-free/free-code',owned_by:'mico-free'},
  {id:'cc/claude-sonnet',owned_by:'cc'},
  {id:'cx/gpt-codex',owned_by:'cx',pricing:{prompt:'2',completion:'8'}},
  {id:'my-coding-combo',owned_by:'combo'},
 ];
 const chats=[];
 const upstream=async(url,options)=>{
  assert.equal(options.headers.Authorization,'Bearer private-client');
  if(url.endsWith('/models'))return Response.json({data:catalogue});
  const body=JSON.parse(options.body);chats.push(body);
  if(body.model==='denied-model')return Response.json({error:{message:'Not permitted by 9Router'}},{status:403});
  return Response.json({choices:[{message:{content:'Response from '+body.model}}]});
 };
 const server=await createLocalServer({webDir:os.tmpdir(),port:0,getManagedConnection:()=>connection,fetchImpl:upstream});
 try{
  const manager=new ProviderManager({dataDir:os.tmpdir(),runtimeDir:os.tmpdir(),gatewayBase:server.origin+'/managed/v1',gatewayKey:'internal',vault:{},fetchImpl:upstream});
  await manager.verify(connection,new AbortController().signal);
  assert.deepEqual(connection.config.routerModels,catalogue.map(m=>m.id));
  const restored=applyManagedConnection({model:'cx/gpt-codex'},managedClientConnection(connection,server.origin));
  assert.equal(restored.model,'cx/gpt-codex');
  assert.equal(restored.managed,true);assert.equal(restored.routerFreeOnly,false);
  assert.deepEqual(restored.freeModels,['mico-free/free-code']);
  // Use the actual desktop HTTP relay and the same discovery function native setup uses.
  const discovered=await discoverProxy(restored,connection.key,AbortSignal.timeout(5000));
  assert.deepEqual(discovered.map(m=>m.id),catalogue.map(m=>m.id));
  assert.equal(discovered.find(m=>m.id==='cx/gpt-codex').paid,true);
  for(const model of ['cc/claude-sonnet','cx/gpt-codex','my-coding-combo']){
   const r=await fetch(restored.proxyUrl+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+connection.key,'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:'Build a portfolio'}],url:'https://wrong.example',stream:true})});
   assert.equal(r.status,200);assert.equal((await r.json()).choices[0].message.content,'Response from '+model);
   assert.equal(chats.at(-1).model,model);assert.equal(chats.at(-1).url,undefined);assert.equal(chats.at(-1).stream,false);
  }
  catalogue=[...catalogue,{id:'ag/gemini-pro',owned_by:'ag'}];
  assert.equal((await listProxyModels(restored,connection.key,AbortSignal.timeout(5000))).length,5);
  const denied=await fetch(restored.proxyUrl+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+connection.key,'Content-Type':'application/json'},body:JSON.stringify({model:'denied-model',messages:[{role:'user',content:'Hi'}]})});
  assert.equal(denied.status,403);assert.equal((await denied.json()).error.message,'Not permitted by 9Router');
 }finally{await server.close()}
});

test('local managed generation serves every installed model',async()=>{
 const limits=[];const bodies=[];
 const inventory=[{name:'test-coder',route:'test-coder'},{name:'test-chat',route:'test-chat'}];
 const messages=[{role:'system',content:'Return one complete coding action object.'},{role:'user',content:'Hello'}];
 const reply={message:'Hello',actions:[],done:true};
 const server=await createLocalServer({webDir:os.tmpdir(),port:0,gatewayKey:'private',getOllamaUpstream:()=> 'http://127.0.0.1:11434',getOllamaModels:()=> inventory,fetchImpl:async(url,options)=>{assert.equal(url,'http://127.0.0.1:11434/api/chat');const parsed=JSON.parse(options.body);assert.deepEqual(parsed.format,actionSchema);assert.equal(parsed.think,false);assert.equal(parsed.stream,false);assert.deepEqual(parsed.messages,messages);bodies.push(parsed.model);limits.push(parsed.options.num_predict);return Response.json({message:{content:JSON.stringify(reply)}})}});
 try{
  const catalogue=await (await fetch(server.origin+'/managed/local/v1/models',{headers:{Authorization:'Bearer private'}})).json();
  assert.deepEqual(catalogue.data.map(m=>m.id),['test-coder','test-chat']);
  for(const request of [{model:'test-coder',max_tokens:20},{model:'test-chat',max_tokens:9000},{model:'test-chat'},{model:'test-coder',max_tokens:1.9}]){const r=await fetch(server.origin+'/managed/local/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer private','Content-Type':'application/json'},body:JSON.stringify({...request,messages})});assert.equal(r.status,200);assert.deepEqual(JSON.parse((await r.json()).choices[0].message.content),reply)}
  assert.deepEqual(limits,[20,4096,4096,1]);assert.deepEqual(bodies,['test-coder','test-chat','test-chat','test-coder']);
  const unknown=await fetch(server.origin+'/managed/local/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer private','Content-Type':'application/json'},body:JSON.stringify({model:'removed-model',messages:[{role:'user',content:'Hello'}]})});
  assert.equal(unknown.status,400);
 }finally{await server.close()}
});

test('local managed routes require engine setup',async()=>{
 const server=await createLocalServer({webDir:os.tmpdir(),port:0,gatewayKey:'private',getOllamaUpstream:()=>null});
 try{
  assert.equal((await fetch(server.origin+'/managed/local/v1/models',{headers:{Authorization:'Bearer private'}})).status,503);
 }finally{await server.close()}
});

test('stopping a managed generation cancels the forwarded request',async()=>{
 let forwarded;let started;const ready=new Promise(resolve=>{started=resolve});
 const connection={config:{proxyUrl:'http://127.0.0.1:55001/v1',model:'mico-free/free-code'},key:'private'};
 const server=await createLocalServer({webDir:os.tmpdir(),port:0,getManagedConnection:()=>connection,fetchImpl:async(_url,options)=>{forwarded=options.signal;started();return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))}});
 try{
  const controller=new AbortController();const pending=fetch(server.origin+'/providers/9router/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer private','Content-Type':'application/json'},body:JSON.stringify({model:connection.config.model,messages:[{role:'user',content:'test'}]}),signal:controller.signal});
  await ready;controller.abort();await assert.rejects(pending,e=>e.name==='AbortError');
  await Promise.race([new Promise(resolve=>forwarded.aborted?resolve():forwarded.addEventListener('abort',resolve,{once:true})),new Promise((_resolve,reject)=>setTimeout(()=>reject(new Error('Forwarded request was not cancelled')),1000))]);assert.equal(forwarded.aborted,true);
 }finally{await server.close()}
});
