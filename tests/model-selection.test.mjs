import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';
import {applyManagedConnection,catalogueError,credentialSlot,discoverProxy,fullCatalogue,listProxyModels,proxyPresets,selectCatalogueModel,supplementOpenCodeModels} from '../lib/mico/providers.mjs';

test('native Ollama setup accepts its intentionally keyless loopback connection',()=>{
 const result={config:{provider:'ollama',ollamaUrl:'http://127.0.0.1:19286/managed/ollama',model:'deepseek-r1:8b'},key:''};
 const connected=applyManagedConnection({temperature:0.2},result);
 assert.equal(connected.managed,true);assert.equal(connected.model,'deepseek-r1:8b');assert.equal(connected.temperature,0.2);
 assert.throws(()=>applyManagedConnection({}, {...result,config:{...result.config,ollamaUrl:'https://remote.example'}}),/local connection/);
 assert.throws(()=>applyManagedConnection({}, {...result,key:undefined}),/incomplete connection/);
 assert.throws(()=>applyManagedConnection({}, {config:{provider:'proxy',proxyPreset:'9router',proxyUrl:'http://127.0.0.1:55000/v1',model:'mico-free/free-code',freeModels:['mico-free/free-code']},key:''}),/incomplete connection/);
});

test('NVIDIA NIM and FreeRide use current endpoints while legacy direct presets stay hidden',async()=>{
 const preset=proxyPresets.find(p=>p.id==='nim'),prior=globalThis.fetch;assert.equal(preset.url,'https://integrate.api.nvidia.com/v1');
 assert.equal(proxyPresets.find(p=>p.id==='freeride').url,'http://127.0.0.1:11343/v1');assert.equal(proxyPresets.find(p=>p.id==='horde').hidden,true);assert.equal(proxyPresets.find(p=>p.id==='opencode').hidden,true);
  globalThis.fetch=async(url,options)=>{assert.equal(url,preset.url+'/models');assert.equal(options.headers.Authorization,'Bearer nvapi-test-key');return Response.json({data:[{id:'nvidia/nemotron',owned_by:'nvidia'},{id:'nvidia/nemotron',owned_by:'nvidia'}]})};
  try{assert.deepEqual((await listProxyModels({provider:'proxy',proxyPreset:'nim',proxyUrl:preset.url},'nvapi-test-key')).map(m=>m.id),['nvidia/nemotron'])}finally{globalThis.fetch=prior}
 const freeride=proxyPresets.find(p=>p.id==='freeride');
 globalThis.fetch=async url=>{assert.equal(url,freeride.url+'/models');return Response.json({data:[{id:'nvidia_nim/nemotron',owned_by:'nvidia_nim'}]})};
 try{assert.ok((await listProxyModels({provider:'proxy',proxyPreset:'freeride',proxyUrl:freeride.url},'any')).some(m=>m.id==='freeride/auto'))}finally{globalThis.fetch=prior}
});

test('catalogue selection preserves exact provider and combo IDs and refuses stale profiles',()=>{
 const models=[{id:'oc/muse-1.3-free',name:'OpenCode Muse'},{id:'cc/claude-sonnet-4.6',name:'Claude'},{id:'My coding combo',name:'My coding combo'}];
 for(const model of models)assert.equal(selectCatalogueModel(models,model.id),model.id);
 assert.throws(()=>selectCatalogueModel(models,'oc/retired-free'),/not in this router’s current catalogue/);
 assert.equal(selectCatalogueModel(models,'oc/exact-new-id',{allowCustom:true}),'oc/exact-new-id');
 assert.equal(selectCatalogueModel([{id:'free/code',verified:true},{id:'paid/claude-sonnet-4.6',paid:true}]),'free/code');
 assert.equal(selectCatalogueModel(models,'',{preferred:'oc/muse-1.3-free'}),'oc/muse-1.3-free');
});

test('live 9Router discovery retains every connected provider model without pricing or prefix filtering',async()=>{
 const previous=globalThis.fetch;
 const ids=['oc/muse-1.3-free','oc/union-alpha','cc/claude-opus-4.6','coding-combo'];
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'http://127.0.0.1:20128/v1/models');assert.equal(options.headers.Authorization,'Bearer router-specific-key');
  return Response.json({data:ids.map((id,index)=>({id,owned_by:index<2?'OpenCode':'Other',...(index===2?{pricing:{prompt:'1',completion:'1'}}:{})}))});
 };
 try{
  const config={provider:'proxy',proxyPreset:'9router',proxyUrl:'http://127.0.0.1:20128/v1',managed:true,freeModels:[],routerFreeOnly:false};
  assert.deepEqual((await listProxyModels(config,'router-specific-key')).map(m=>m.id),ids);
  assert.deepEqual((await discoverProxy(config,'router-specific-key')).map(m=>m.id),ids);
 }finally{globalThis.fetch=previous}
});

test('manual 9Router discovers current free OpenCode routes without leaking its key or replacing router entries',async()=>{
 const previous=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push({url,authorization:options.headers.Authorization});
  if(url==='/api/opencode')return Response.json({models:[{id:'muse-new-free',name:'Muse New',verified:true,paid:false,contextLength:64000},{id:'already-listed',name:'Other name',verified:true,paid:false},{id:'paid-name-free',verified:true,paid:true},{id:'unknown-free',verified:false,paid:false},{id:'invalid/path',verified:true,paid:false}]});
  return Response.json({data:[{id:'local-coder',pricing:{prompt:0,completion:0}},{id:'oc/already-listed',name:'Router name',pricing:{prompt:1,completion:1}},{id:'combo-name'}]});
 };
 try{
  const models=await listProxyModels({proxyPreset:'9router',proxyUrl:'http://127.0.0.1:20128/v1',managed:false},'private-router-key');
  assert.deepEqual(models.map(m=>m.id),['local-coder','oc/already-listed','combo-name','oc/muse-new-free']);
  assert.equal(models[1].name,'Router name');assert.equal(models[1].paid,true);assert.equal(models[1].catalogueSource,undefined);
  assert.deepEqual(models[3],{id:'oc/muse-new-free',name:'Muse New',provider:'OpenCode Free (live catalogue)',verified:true,paid:false,catalogueSource:'opencode-live',accessUnchecked:true,contextLength:64000});
  assert.deepEqual(calls,[{url:'http://127.0.0.1:20128/v1/models',authorization:'Bearer private-router-key'},{url:'/api/opencode',authorization:undefined}]);
 }finally{globalThis.fetch=previous}
});

test('public OpenCode discovery failure leaves manual router models usable with an explicit warning',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async(url)=>url==='/api/opencode'?Response.json({error:'temporarily offline'},{status:503}):Response.json({data:[{id:'connected-model'}]});
 try{
  const models=await listProxyModels({proxyPreset:'9router',proxyUrl:'http://127.0.0.1:20128/v1',managed:false},'private');
  assert.deepEqual(models.map(m=>m.id),['connected-model']);assert.match(models.catalogueWarning,/OpenCode free model discovery is unavailable.*router catalogue is still available/);
  assert.ok(!models.catalogueWarning.includes('private'));
 }finally{globalThis.fetch=previous}
});

test('blank recommendation keeps actual router defaults ahead of unchecked OpenCode discoveries',()=>{
 const models=supplementOpenCodeModels([{id:'connected-coder',name:'Working model'}],[{id:'muse-new-free',verified:true,paid:false}]);
 assert.equal(selectCatalogueModel(models,''),'connected-coder');
 assert.equal(selectCatalogueModel(models,'connected-coder'),'connected-coder');
 assert.equal(selectCatalogueModel(models,'oc/muse-new-free'),'oc/muse-new-free');
});

test('managed OpenCode source markers survive catalogue normalization and unrelated raw fields are stripped',()=>{
 const [model]=fullCatalogue({data:[{id:'oc/current-free',name:'Current free',owned_by:'OpenCode Free',catalogueSource:'opencode-live',accessUnchecked:true,pricing:{prompt:0,completion:0},arbitraryField:'not trusted'}]});
 assert.equal(model.catalogueSource,'opencode-live');assert.equal(model.accessUnchecked,true);assert.equal(model.provider,'OpenCode Free (live catalogue)');assert.equal(model.arbitraryField,undefined);
 assert.deepEqual(supplementOpenCodeModels([model],[{id:'current-free',verified:true,paid:false}]),[model]);
 const [ordinary]=fullCatalogue({data:[{id:'router-listed',catalogueSource:'arbitrary',accessUnchecked:true}]});
 assert.equal(ordinary.catalogueSource,undefined);assert.equal(ordinary.accessUnchecked,undefined);
});

test('cancelling supplemental discovery rejects instead of returning a stale catalogue',async()=>{
 const previous=globalThis.fetch,abort=new AbortController();let discoveryStarted;
 const started=new Promise(resolve=>{discoveryStarted=resolve});
 globalThis.fetch=async(url,options)=>{
  if(url!=='/api/opencode')return Response.json({data:[{id:'router-model'}]});
  discoveryStarted();return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
 };
 try{
  const request=listProxyModels({proxyPreset:'9router',proxyUrl:'http://127.0.0.1:20128/v1',managed:false},'private',abort.signal);
  await started;abort.abort();await assert.rejects(request,error=>error.name==='AbortError');
 }finally{globalThis.fetch=previous}
});

test('catalogue failures explain key permissions, invalid URLs and provider limits',async()=>{
 assert.match(catalogueError(401,{error:{message:'Unauthorized'}},'9Router').message,/exact router address.*Unauthorized/);
 assert.match(catalogueError(403,{error:{}},'9Router').message,/model permissions/);
 assert.match(catalogueError(429,{error:'rate limit'},'9Router').message,/rate limited/);
 const previous=globalThis.fetch;
 const config={proxyPreset:'9router',proxyUrl:'http://127.0.0.1:20128/v1'};
 try{
  globalThis.fetch=async()=>new Response('<html>dashboard</html>',{status:200});
  await assert.rejects(listProxyModels(config,''),/non-JSON model catalogue.*dashboard URL/);
  globalThis.fetch=async()=>Response.json({error:{message:'Not found'}},{status:404});
  await assert.rejects(listProxyModels(config,''),/API base URL.*Not found/);
  const signal=AbortSignal.abort(new DOMException('Expired','TimeoutError'));
  globalThis.fetch=async()=>{throw signal.reason};
  await assert.rejects(listProxyModels(config,'',signal),/catalogue request timed out/);
  globalThis.fetch=async()=>Response.json({});
  await assert.rejects(listProxyModels({...config,proxyPreset:'opencode'},''),/invalid model list.*update MicoCode/);
 }finally{globalThis.fetch=previous}
});

test('OpenCode free discovery uses the fixed MicoCode relay without forwarding a key to public discovery',async()=>{
 const previous=globalThis.fetch;
 const models=[{id:'muse-1.3-free',name:'Muse 1.3',verified:true,paid:false,provider:'OpenCode Zen'}];
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'/api/opencode');assert.deepEqual(JSON.parse(options.body),{action:'models'});assert.equal(options.headers.Authorization,undefined);
  return Response.json({models});
 };
 try{
  const config={provider:'proxy',proxyPreset:'opencode',proxyUrl:'https://opencode.ai/zen/v1'};
  assert.deepEqual(await listProxyModels(config,'private-zen-key'),models);
  assert.deepEqual(await discoverProxy(config,'private-zen-key'),models);
  assert.equal(credentialSlot(config),'mico-key:proxy:https://opencode.ai/zen/v1');
  assert.notEqual(credentialSlot(config),credentialSlot({...config,proxyPreset:'9router',proxyUrl:'http://127.0.0.1:20128/v1'}));
 }finally{globalThis.fetch=previous}
});

test('model selection during native refresh is preserved after the older IPC result arrives',async context=>{
 let electron;try{electron=(await import('electron')).default}catch{context.skip('Electron runtime is unavailable.');return}
 if(typeof electron!=='string'||!existsSync(electron)){context.skip('Electron runtime is unavailable.');return}
 const repo=fileURLToPath(new URL('../',import.meta.url)),prefix=path.join(os.tmpdir(),'mico-selection-race-');
 const dir=await mkdtemp(prefix);
 try{
  const renderer=`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {Connections} from ${JSON.stringify(path.join(repo,'components/micocode/connections.tsx'))};
import {defaultConfig} from ${JSON.stringify(path.join(repo,'lib/mico/types.ts'))};
const initial={...defaultConfig,provider:'proxy',managed:true,proxyPreset:'9router',proxyUrl:'http://127.0.0.1:19286/providers/9router/v1',model:'mico-free/current',freeModels:['mico-free/current'],routerModels:['mico-free/current','oc/second'],routerEngine:'local'};
let releaseRefresh,refreshStarted=false,current=initial;const writes=[];
window.micoDesktop={onProgress:()=>()=>{},refreshModels:()=>{refreshStarted=true;return new Promise(resolve=>{releaseRefresh=()=>resolve({config:initial,key:'private'})})}};
window.fetch=async()=>Response.json({data:[{id:'mico-free/current',name:'Current model',pricing:{prompt:0,completion:0}},{id:'oc/second',name:'Second model',pricing:{prompt:0,completion:0}}]});
function Fixture(){const [config,setConfig]=useState(initial);return React.createElement(Connections,{config,apiKey:'private',setConfig:next=>{current=next;writes.push(next.model);setConfig(next)},setKey:()=>{},onReady:()=>{},onClose:()=>{}})}
createRoot(document.querySelector('#root')).render(React.createElement(Fixture));
const wait=async(check,stage)=>{for(let i=0;i<150;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,20))}throw new Error('Fixture UI did not reach '+stage)};
(async()=>{await wait(()=>{const button=document.querySelector('[aria-label="Refresh model catalogue"]');return button&&!button.disabled&&document.querySelector('.model-count')?.textContent.includes('2 models')},'loaded catalogue');document.querySelector('[aria-label="Refresh model catalogue"]').click();await wait(()=>refreshStarted,'native refresh');const input=document.querySelector('[role="combobox"]');input.focus();input.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));await wait(()=>[...document.querySelectorAll('[role="option"]')].some(row=>row.textContent.includes('oc/second')),'second option');[...document.querySelectorAll('[role="option"]')].find(row=>row.textContent.includes('oc/second')).click();await wait(()=>current.model==='oc/second','model selection');releaseRefresh();await new Promise(resolve=>setTimeout(resolve,150));console.log('MODEL_RACE_RESULT '+JSON.stringify({model:current.model,input:document.querySelector('[role="combobox"]').value,writes,status:document.querySelector('.connection-status')?.textContent}))})().catch(error=>console.log('MODEL_RACE_RESULT '+JSON.stringify({error:error.message,body:document.body.textContent})));`;
  const bundled=await build({stdin:{contents:renderer,resolveDir:repo,sourcefile:'model-selection-fixture.tsx'},bundle:true,write:false,format:'esm',platform:'browser',tsconfig:path.join(repo,'tsconfig.json')});
  await writeFile(path.join(dir,'bundle.js'),bundled.outputFiles[0].contents);
  const main=`const {app,BrowserWindow}=require('electron');const http=require('node:http');const fs=require('node:fs');const path=require('node:path');let server;app.setPath('userData',path.join(__dirname,'profile'));app.whenReady().then(async()=>{server=http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(__dirname,'bundle.js')))}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>')}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.webContents.on('console-message',details=>{if(details.message.startsWith('MODEL_RACE_RESULT ')){fs.writeFileSync(path.join(__dirname,'report.json'),details.message.slice(18));app.quit()}});await win.loadURL('http://127.0.0.1:'+server.address().port);setTimeout(()=>app.quit(),15000)});app.on('window-all-closed',()=>app.quit());app.on('will-quit',()=>server?.close());`;
  const mainPath=path.join(dir,'main.cjs');await writeFile(mainPath,main);
  await promisify(execFile)(electron,[mainPath],{windowsHide:true,timeout:25000,maxBuffer:1000000});
  const result=JSON.parse(await readFile(path.join(dir,'report.json'),'utf8'));
  assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.model,'oc/second');assert.equal(result.input,'oc/second');
  assert.deepEqual(result.writes,['oc/second']);assert.match(result.status,/Selected Second model/);
 }finally{if(path.resolve(dir).startsWith(path.resolve(prefix)))await rm(dir,{recursive:true,force:true})}
});
