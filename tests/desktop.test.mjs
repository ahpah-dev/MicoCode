import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import JSZip from 'jszip';
import {archivePath,extractVerifiedZip,downloadVerified} from '../desktop/install.mjs';
import {assertProvider,assertEngine,cliProxyConfig,liteLLMConfig,ProviderManager} from '../desktop/provider-manager.mjs';
import {isLocalRequest,createLocalServer,managedClientConnection} from '../desktop/server.mjs';

test('provider automation only accepts supported installer IDs',()=>{for(const id of ['9router','cliproxy','litellm','ollama'])assert.equal(assertProvider(id),id);for(const id of ['../ollama','custom','powershell','9router;whoami',null])assert.throws(()=>assertProvider(id))});
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
 const routes=['qwen2-5-coder-3b','llama3-1-8b'];
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
 const server=await createLocalServer({webDir:os.tmpdir(),port:0,gatewayKey:'internal',getManagedConnection:id=>id==='9router'?connection:null,fetchImpl:async(url,options)=>{calls++;sent={url,options};return Response.json({error:{message:'Daily free quota exhausted'}},{status:429,headers:{'Retry-After':'120'}})}});
 try{
  const exposed=managedClientConnection(connection,server.origin);assert.equal(exposed.config.proxyUrl,server.origin+'/providers/9router/v1');assert.equal(connection.config.proxyUrl,'http://127.0.0.1:55001/v1');
  const endpoint=exposed.config.proxyUrl+'/chat/completions';const headers={Authorization:'Bearer private-client','Content-Type':'application/json',Origin:server.origin};
  const body={model:connection.config.model,messages:[{role:'user',content:'A coding task'}],max_tokens:30,stream:true,url:'https://paid.example'};
  const r=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'120');assert.equal((await r.json()).error.message,'Daily free quota exhausted');
  assert.equal(sent.url,'http://127.0.0.1:55001/v1/chat/completions');assert.equal(sent.options.redirect,'error');assert.equal(sent.options.headers.Authorization,'Bearer private-client');assert.equal(JSON.parse(sent.options.body).stream,false);assert.equal(JSON.parse(sent.options.body).url,undefined);
  assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({...body,model:'paid-model'})})).status,400);
  assert.equal((await fetch(endpoint,{method:'POST',headers:{...headers,Origin:'https://other.example'},body:JSON.stringify(body)})).status,403);
  assert.equal((await fetch(endpoint,{method:'POST',headers:{...headers,Authorization:'Bearer other'},body:JSON.stringify(body)})).status,401);
  assert.equal((await fetch(endpoint)).status,401);assert.equal(calls,1);
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
 const connection={config:{provider:'proxy',proxyPreset:'cliproxy',proxyUrl:'http://127.0.0.1:55002/v1',model:'qwen2-5-coder-3b',freeModels:['qwen2-5-coder-3b','llama3-1-8b']},key:'private-client'};
 const server=await createLocalServer({webDir:os.tmpdir(),port:0,gatewayKey:'internal',getManagedConnection:()=>connection,fetchImpl:async()=>Response.json({choices:[{message:{content:'{}'}}]})});
 try{
  const endpoint=server.origin+'/providers/cliproxy/v1/chat/completions';const headers={Authorization:'Bearer private-client','Content-Type':'application/json',Origin:server.origin};
  const body={model:'llama3-1-8b',messages:[{role:'user',content:'Hi'}]};
  assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body)})).status,200);
  assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({...body,model:'paid-model'})})).status,400);
 }finally{await server.close()}
});

test('local managed generation serves every installed model',async()=>{
 const limits=[];const bodies=[];
 const inventory=[{name:'test-coder',route:'test-coder'},{name:'test-chat',route:'test-chat'}];
 const server=await createLocalServer({webDir:os.tmpdir(),port:0,gatewayKey:'private',getOllamaUpstream:()=> 'http://127.0.0.1:11434',getOllamaModels:()=> inventory,fetchImpl:async(url,options)=>{assert.equal(url,'http://127.0.0.1:11434/api/chat');const parsed=JSON.parse(options.body);bodies.push(parsed.model);limits.push(parsed.options.num_predict);return Response.json({message:{content:'{"message":"Hello"}'}})}});
 try{
  const catalogue=await (await fetch(server.origin+'/managed/local/v1/models',{headers:{Authorization:'Bearer private'}})).json();
  assert.deepEqual(catalogue.data.map(m=>m.id),['test-coder','test-chat']);
  for(const max_tokens of [20,9000,undefined]){const r=await fetch(server.origin+'/managed/local/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer private','Content-Type':'application/json'},body:JSON.stringify({model:'test-chat',messages:[{role:'user',content:'Hello'}],max_tokens})});assert.equal(r.status,200);assert.ok((await r.json()).choices[0].message.content)}
  assert.deepEqual(limits,[20,4096,1800]);assert.deepEqual(bodies,['test-chat','test-chat','test-chat']);
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
