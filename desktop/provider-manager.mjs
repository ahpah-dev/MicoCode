import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,access,readdir,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {freeCatalogue,fullCatalogue,routeSlug} from '../lib/mico/providers.mjs';
import {loadOpenCodeModels} from '../lib/mico/opencode.mjs';
import {managedRouterCatalogue} from './server.mjs';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {artifacts,versions} from './artifacts.mjs';
import {downloadVerified,extractVerifiedZip} from './install.mjs';

export const managedProviders=['9router','cliproxy','litellm','ollama'];
export function assertProvider(id){if(!managedProviders.includes(id))throw new Error('Unsupported managed provider.');return id}
export function assertEngine(engine){if(!['local','community'].includes(engine))throw new Error('Unsupported free engine.');return engine}
const exists=async file=>{try{await access(file,constants.F_OK);return true}catch{return false}};
const pause=(ms,signal)=>new Promise((resolve,reject)=>{if(signal?.aborted)return reject(new Error('Setup cancelled.'));const done=()=>{signal?.removeEventListener('abort',abort);resolve()};const timer=setTimeout(done,ms);const abort=()=>{clearTimeout(timer);reject(new Error('Setup cancelled.'))};signal?.addEventListener('abort',abort,{once:true})});
async function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port))})})}
export function liteLLMConfig(port,key,base,upstreamKey,routes=['free-code']){
 const entries=routes.map(id=>`  - model_name: ${JSON.stringify(id)}\n    litellm_params:\n      model: ${JSON.stringify('openai/'+id)}\n      api_base: ${JSON.stringify(base)}\n      api_key: ${JSON.stringify(upstreamKey)}\n      timeout: 600\n      max_retries: 0`).join('\n');
 return `model_list:\n${entries}\ngeneral_settings:\n  master_key: ${JSON.stringify(key)}\nlitellm_settings:\n  drop_params: true\n  num_retries: 0\n  request_timeout: 600\n`;
}
export function cliProxyConfig(port,key,base,upstreamKey,authDir,routes=['free-code']){
 const models=routes.map(id=>`        - name: ${JSON.stringify(id)}\n          alias: ${JSON.stringify(id)}\n          input-modalities: [text]`).join('\n');
 return `server:\n  host: 127.0.0.1\n  port: ${port}\naccess:\n  api-keys:\n    - ${JSON.stringify(key)}\nmanagement:\n  allow-remote: false\n  secret-key: ""\n  disable-control-panel: true\noauth:\n  auth-dir: ${JSON.stringify(authDir.replace(/\\/g,'/'))}\napi-keys:\n  openai-compatibility:\n    - name: micocode-community\n      base-url: ${JSON.stringify(base)}\n      keys:\n        - api-key: ${JSON.stringify(upstreamKey)}\n      models:\n${models}\nrequests:\n  passthrough-headers: false\nobservability:\n  logs:\n    request-log: false\n    debug: false\n`;
}
export class ProviderManager{
 constructor({dataDir,runtimeDir,gatewayBase,gatewayKey,onProgress=()=>{},vault,fetchImpl=fetch,onDiagnostic=()=>{},loadOpenCodeModelsImpl=loadOpenCodeModels}){
  this.root=path.join(dataDir,'providers');this.runtime=runtimeDir;this.gatewayBase=gatewayBase;this.gatewayKey=gatewayKey;
   this.notify=onProgress;this.vault=vault;this.fetch=fetchImpl;this.diagnostic=onDiagnostic;this.loadOpenCodeModels=loadOpenCodeModelsImpl;this.children=new Map();this.connections=new Map();this.active=null;this.cookies=new Map();this.ollamaUpstream=null;this.ollamaModel=null;this.ollamaModels=null;this.closing=false;
 }
 folder(id){return path.join(this.root,assertProvider(id))}
 versionFolder(id){return path.join(this.folder(id),id==='9router'?versions.nine:id==='litellm'?versions.litellm:artifacts[id].version)}
 emit(provider,stage,message,percent){this.notify({provider,stage,message,...(Number.isFinite(percent)?{percent}: {})})}
 async secret(name){let key=await this.vault.get(name);if(!key){key='sk-mico-'+randomBytes(24).toString('hex');await this.vault.set(name,key)}return key}
 async statuses(){return Promise.all(managedProviders.map(async provider=>({provider,installed:await exists(path.join(this.folder(provider),'installed.json')),running:!!this.children.get(provider)&&this.children.get(provider).exitCode===null})))}
 async run(exe,args,{cwd,env={},signal,timeout=900000}={}){
  if(signal?.aborted)throw new Error('Setup cancelled.');
  // No shell, global installation, user-controlled command, or provider output in the UI.
  const child=spawn(exe,args,{cwd,env:{...process.env,...env},windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});
  const finish=()=>{signal?.removeEventListener('abort',cancel);clearTimeout(timer)};
  const cancel=()=>{void this.killChild(child)};signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(cancel,timeout);let output='';
  child.stdout.on('data',chunk=>{output=(output+chunk.toString()).slice(-4000)});child.stderr.on('data',chunk=>{output=(output+chunk.toString()).slice(-4000)});
  await new Promise((resolve,reject)=>{child.once('error',e=>{finish();reject(new Error('Unable to start the private provider installer: '+e.code))});child.once('exit',code=>{finish();if(signal?.aborted)return reject(new Error('Setup cancelled.'));if(code!==0)return reject(new Error(/ENOSPC|No space|disk space/i.test(output)?'Not enough disk space to install this provider.':/ENOTFOUND|ETIMEDOUT|network|connection|fetch|download/i.test(output)?'Provider installation could not finish downloading. Check your connection and retry.':'Provider installation did not finish. Retry setup; no global installation is required.'));resolve()})});
 }
 start(id,exe,args,options={}){
  if(this.closing)throw new Error('MicoCode is closing.');
  const previous=this.children.get(id);if(previous?.exitCode===null)return previous;
  const child=spawn(exe,args,{...options,env:{...process.env,...options.env},windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
  // Consume output without persisting prompts or credentials.
  const log=chunk=>this.diagnostic(id,chunk.toString().replace(/sk-mico-[\w-]+|sk-[a-zA-Z0-9_-]{20,}|integration-only-free-route/g,'[redacted]').slice(-3000));
  const forget=()=>{if(this.children.get(id)===child){this.children.delete(id);this.connections.delete(id)}};
  child.stdout.on('data',log);child.stderr.on('data',log);child.on('error',e=>{forget();this.diagnostic(id,e.code||'Process start failed.')});child.once('exit',forget);
  this.children.set(id,child);return child;
 }
 async killChild(child){
  if(!child?.pid||child.exitCode!==null)return;
  if(process.platform==='win32')await new Promise(resolve=>{const killer=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',shell:false});killer.on('error',resolve);killer.on('exit',resolve)});
  else child.kill('SIGTERM');
 }
 async stop(id){assertProvider(id);await this.killChild(this.children.get(id));this.children.delete(id);this.connections.delete(id)}
 async close(){this.closing=true;this.active?.controller.abort();await Promise.all([...this.children.values()].map(c=>this.killChild(c)));this.children.clear()}
 cancel(){this.active?.controller.abort()}
 async ready(url,id,signal,headers={}){
  for(let i=0;i<100;i++){
   if(signal.aborted)throw new Error('Setup cancelled.');
   const child=this.children.get(id);if(!child||child.exitCode!==null)throw new Error('The provider stopped before it was ready. Retry setup.');
   try{const r=await this.fetch(url,{headers,signal:AbortSignal.any([signal,AbortSignal.timeout(2000)])});if(r.ok)return}catch{}
   await pause(500,signal);
  }throw new Error('The provider did not start in time. Retry setup.');
 }
 async installZip(id,artifact,signal){
  const dir=this.versionFolder(id);if(await exists(path.join(dir,'.package-ready.json')))return dir;
  const zip=path.join(this.root,'downloads',id+'-'+artifact.version+'.zip');
  this.emit(id,'download','Downloading '+(id==='cliproxy'?'CLIProxyAPI':id==='ollama'?'Ollama':'the private Python installer')+' from its official release…');
  await downloadVerified(artifact,zip,signal,percent=>this.emit(id,'download','Downloading the verified provider package…',percent));
  this.emit(id,'install','Checksum verified. Extracting into MicoCode’s private folder…');
  // A prior interrupted extraction was never marked installed; its private version folder may be replaced.
  if(await exists(dir))await rm(dir,{recursive:true,force:true});
  await extractVerifiedZip(zip,dir,signal);await writeFile(path.join(dir,'.package-ready.json'),JSON.stringify({version:artifact.version}));await rm(zip,{force:true});return dir;
 }
 async setup(id,engine='local'){
  assertProvider(id);assertEngine(engine);if(this.active)throw new Error('Another provider setup is already running.');
  const controller=new AbortController();this.active={id,controller};const signal=controller.signal;
  const hadChild=this.children.get(id);
  try{
   await mkdir(this.folder(id),{recursive:true});
   const cached=this.connections.get(id);if(cached&&cached.config.routerEngine===engine&&hadChild?.exitCode===null){
    this.emit(id,'verify','Checking the running connection…');
    try{if(id!=='ollama'&&engine==='local')await this.verifyLocalEngine(signal);if(id==='9router')await this.syncOpenCodeCatalogue(cached,signal);await this.verify(cached,signal);this.emit(id,'ready','Connected. Your free route is ready.');return cached}
    catch(e){if(signal.aborted)throw e;this.emit(id,'configure','Repairing the private router connection…');await this.stop(id)}
   }
   if(this.children.get(id)?.exitCode===null)await this.stop(id);
   if(id!=='ollama'&&engine==='local'){
    this.emit(id,'configure','Preparing the free local engine for your router…');
    const local=await this.setupOllama(signal);await this.verify(local,signal);this.connections.set('ollama',local);
    await writeFile(path.join(this.folder('ollama'),'installed.json'),JSON.stringify({version:artifacts.ollama.version}),{mode:0o600});
   }
   const base=this.gatewayBase.replace('/managed/v1','/managed/'+engine+'/v1');
   let connection;
   if(id==='9router')connection=await this.setupNine(signal,base);
   else if(id==='cliproxy')connection=await this.setupCLI(signal,base);
   else if(id==='litellm')connection=await this.setupLite(signal,base);
   else connection=await this.setupOllama(signal);
   if(id==='9router')await this.syncOpenCodeCatalogue(connection,signal);
   this.emit(id,'verify','Verifying the model catalogue and free route…');await this.verify(connection,signal);
   await writeFile(path.join(this.folder(id),'installed.json'),JSON.stringify({version:id==='9router'?versions.nine:id==='litellm'?versions.litellm:artifacts[id].version}),{mode:0o600});
   connection.config.routerEngine=id==='ollama'?'local':engine;connection.config.managed=true;
   await writeFile(path.join(this.root,'last-provider.json'),JSON.stringify({provider:id,engine}),{mode:0o600});
   this.connections.set(id,connection);this.emit(id,'ready',id==='ollama'?'Local coding model connected. No account or service quota.':'Connected through '+(id==='9router'?'9Router':id==='cliproxy'?'CLIProxyAPI':'LiteLLM')+'. Your free '+engine+' route is ready.');return connection;
  }catch(e){if(this.children.get(id)!==hadChild)await this.stop(id);this.emit(id,signal.aborted?'cancelled':'error',signal.aborted?'Setup cancelled. You can resume with the same button.':e.message);throw e}
  finally{this.active=null}
 }
 async restore(){
  try{const {provider,engine='local'}=JSON.parse(await readFile(path.join(this.root,'last-provider.json'),'utf8'));assertProvider(provider);if(!await exists(path.join(this.folder(provider),'installed.json')))return null;return await this.setup(provider,engine)}catch{return null}
 }
 async verifyLocalEngine(signal){
  if(!this.ollamaUpstream||!this.ollamaModel||!Array.isArray(this.ollamaModels)||!this.ollamaModels.length)throw new Error('The local coding engine must be reconnected.');
  const r=await this.fetch(this.ollamaUpstream+'/api/tags',{signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])});
  if(!r.ok)throw new Error('The local coding engine stopped responding.');
  const d=await r.json(),names=new Set((d.models||[]).map(m=>m?.name).filter(n=>typeof n==='string'&&n));
  if(!names.has(this.ollamaModel)||names.size!==this.ollamaModels.length||this.ollamaModels.some(m=>!names.has(m.name)))throw new Error('The installed local model inventory changed. Reconnecting the router.');
 }
 async verify(connection,signal){
  const local=connection.config.provider==='ollama';const url=local?connection.config.ollamaUrl+'/api/tags':connection.config.proxyUrl+'/models';
  const r=await this.fetch(url,{headers:connection.key?{Authorization:'Bearer '+connection.key}:{},signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
  if(!r.ok)throw new Error('The installed provider did not accept its connection ('+r.status+'). Retry setup.');
   const d=await r.json();
   const nine=connection.config.proxyPreset==='9router';
   const ids=local?(d.models||[]).map(m=>m.name):(nine?fullCatalogue(managedRouterCatalogue(d,connection)):freeCatalogue(d,connection.config.freeModels,connection.config.routerFreeOnly)).map(m=>m.id);
   if(!ids.includes(connection.config.model))throw new Error('The router did not expose the configured model. Retry setup.');
   if(nine)connection.config.routerModels=ids;
 }
 async nineRequest(base,route,signal,{method='GET',body}={}){
  const r=await this.fetch(base+route,{method,headers:{'Content-Type':'application/json',Cookie:this.cookies.get('9router')||''},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
  const cookie=r.headers.get('set-cookie')?.split(';')[0];if(cookie)this.cookies.set('9router',cookie);
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error('9Router configuration could not finish ('+r.status+'). Retry setup.');return d;
 }
 async syncOpenCodeCatalogue(connection,signal=AbortSignal.timeout(30000)){
  if(connection?.config?.proxyPreset!=='9router'||!connection.dashboard||!this.cookies.get('9router'))return {updated:0};
  delete connection.catalogueWarning;
  try{
   const dashboard=new URL(connection.dashboard),api=new URL(connection.config.proxyUrl);
   if(dashboard.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(dashboard.hostname)||dashboard.origin!==api.origin||dashboard.username||dashboard.password)throw new Error('Invalid private dashboard address.');
   const [{connections=[]},disabled,clientKeys]=await Promise.all([
    this.nineRequest(dashboard.origin,'/api/providers',signal),
    this.nineRequest(dashboard.origin,'/api/models/disabled?providerAlias=oc',signal),
    this.nineRequest(dashboard.origin,'/api/keys',signal),
   ]);
   if(!Array.isArray(disabled.ids)||!Array.isArray(clientKeys.keys))throw new Error('The private router model-access policy could not be checked.');
   // Keep explicit selections. A prior list stays automatic only while it
   // exactly matches the marker saved when MicoCode populated that list.
   const ownsList=c=>{const enabled=c.providerSpecificData?.enabledModels,marker=c.providerSpecificData?.micoFreeCatalogue;return Array.isArray(enabled)&&Array.isArray(marker)&&enabled.length===marker.length&&enabled.every((id,i)=>id===marker[i])};
   const candidates=connections.filter(c=>{if(!c||c.isActive!==true||!['opencode','opencode-zen'].includes(c.provider)||typeof c.id!=='string'||!c.id)return false;const enabled=c.providerSpecificData?.enabledModels,marker=c.providerSpecificData?.micoFreeCatalogue;return ownsList(c)||marker==null&&(enabled==null||Array.isArray(enabled)&&enabled.length===0)});
   const models=await this.loadOpenCodeModels(this.fetch,AbortSignal.any([signal,AbortSignal.timeout(20000)]));
   const verified=new Map(models.filter(m=>m?.verified===true&&m.paid===false&&typeof m.id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(m.id)).map(m=>[m.id,m]));
   const ids=[...verified.keys()];
   let updated=0;
   for(const candidate of candidates){
    const enabled=candidate.providerSpecificData?.enabledModels,marker=candidate.providerSpecificData?.micoFreeCatalogue;
    if(!ids.length&&!ownsList(candidate))continue;
    if(Array.isArray(enabled)&&Array.isArray(marker)&&enabled.length===ids.length&&marker.length===ids.length&&ids.every((id,i)=>enabled[i]===id&&marker[i]===id))continue;
    await this.nineRequest(dashboard.origin,'/api/providers/'+encodeURIComponent(candidate.id),signal,{method:'PUT',body:{providerSpecificData:{enabledModels:ids,micoFreeCatalogue:ids}}});updated++;
   }
   const key=clientKeys.keys.find(k=>k&&k.key===connection.key),blocked=new Set(disabled.ids.filter(id=>typeof id==='string'));
   const allowed=key?.allowedModels;
   const keyActive=key&&key.isActive!==false&&key.active!==false&&(!key.expiresAt||Date.parse(key.expiresAt)>Date.now());
   const policyKnown=allowed==null||Array.isArray(allowed)&&allowed.every(id=>typeof id==='string');
   connection.openCodeFreeModels=[];
   if(keyActive&&policyKnown){
    const permitted=Array.isArray(allowed)&&allowed.length?new Set(allowed):null;
    connection.openCodeFreeModels=[...verified.values()].filter(m=>!blocked.has('*')&&!blocked.has(m.id)&&!blocked.has('oc/'+m.id)&&(!permitted||permitted.has('oc/'+m.id))).map(m=>({
     id:'oc/'+m.id,name:m.name||m.id,object:'model',owned_by:'OpenCode Free',catalogueSource:'opencode-live',accessUnchecked:true,
     pricing:{prompt:'0',completion:'0',input:0,output:0},cost:{input:0,output:0},
     ...(m.contextLength?{context_length:m.contextLength}:{}),...(m.maxOutput?{max_completion_tokens:m.maxOutput}:{}),
    }));
   }
   let warning='';
   if(!ids.length)warning='No verified free OpenCode text models are currently available. Other router models remain available; refresh later.';
   else if(!keyActive||!policyKnown)warning='OpenCode public models could not be added because the managed router key access could not be verified. Other router models remain available.';
   if(warning){connection.catalogueWarning=warning;this.emit('9router','warning',warning);return {updated,models:ids,publicModels:connection.openCodeFreeModels.length,warning}}
   if(updated||connection.openCodeFreeModels.length)this.emit('9router','configure','Loaded '+connection.openCodeFreeModels.length+' verified free models from the live OpenCode catalogue.');
   delete connection.catalogueWarning;return {updated,models:ids,publicModels:connection.openCodeFreeModels.length};
  }catch(e){
   if(signal.aborted)throw e;
   connection.openCodeFreeModels=[];
   const warning='OpenCode model discovery could not refresh. Existing router models remain available; retry Refresh models later.';
   connection.catalogueWarning=warning;this.emit('9router','warning',warning);return {updated:0,warning};
  }
 }
 async refreshNineCatalogue(signal=AbortSignal.timeout(30000)){
  const connection=this.connections.get('9router');if(!connection)throw new Error('Your managed 9Router is stopped. Run Set up & connect first.');
  await this.syncOpenCodeCatalogue(connection,signal);await this.verify(connection,signal);return connection;
 }
 // Every route the managed engine currently offers, read from the gateway itself
 // so routers, connections, and the model picker share one source of truth.
 async managedRoutes(gatewayBase,signal){
  const r=await this.fetch(gatewayBase+'/models',{headers:{Authorization:'Bearer '+this.gatewayKey},signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error('The managed model catalogue is unavailable ('+r.status+'). Retry setup.');
  const routes=(d.data||[]).filter(m=>m&&typeof m.id==='string'&&m.id);
  if(!routes.length)throw new Error('The managed engine exposed no models. Retry setup.');
  return routes;
 }
 // Default to the installed coder model when it is offered, otherwise the first route.
 preferredRoute(routes){return routes.find(r=>r.name===this.ollamaModel)?.id||routes[0].id}
 async setupNine(signal,gatewayBase){
  const id='9router',dir=this.versionFolder(id),node=path.join(this.runtime,'node.exe');
  const appDir=path.join(dir,'node_modules','9router','app');
  if(!await exists(path.join(appDir,'server.js'))){
   this.emit(id,'install','Installing 9Router '+versions.nine+' with MicoCode’s bundled Node runtime…');await mkdir(dir,{recursive:true});
   await writeFile(path.join(dir,'package.json'),JSON.stringify({name:'mico-managed-9router',private:true,dependencies:{'9router':versions.nine}}));
   const npmDir=path.join(this.root,'runtime','node-'+versions.node),npmCLI=path.join(npmDir,'npm','bin','npm-cli.js');
   if(!await exists(npmCLI))await extractVerifiedZip(path.join(this.runtime,'npm-runtime.zip'),npmDir,signal);
   const npmConfig=path.join(this.root,'npmrc');await writeFile(npmConfig,'registry=https://registry.npmjs.org/\nignore-scripts=true\n');
   await this.run(node,[npmCLI,'install','--ignore-scripts','--omit=dev','--no-audit','--no-fund','--registry=https://registry.npmjs.org/'],{cwd:dir,signal,env:{PATH:this.runtime+path.delimiter+process.env.PATH,npm_config_cache:path.join(this.root,'npm-cache'),npm_config_userconfig:npmConfig}});
  }
  const port=await freePort(),base='http://127.0.0.1:'+port;const password=await this.secret('9router-password'),jwt=await this.secret('9router-jwt');
  this.emit(id,'start','Starting your private 9Router on localhost…');
  const entry=await exists(path.join(appDir,'custom-server.js'))?'custom-server.js':'server.js';
  this.start(id,node,['--dns-result-order=ipv4first',path.join(appDir,entry)],{cwd:appDir,env:{PORT:String(port),HOSTNAME:'127.0.0.1',DATA_DIR:path.join(this.folder(id),'data'),INITIAL_PASSWORD:password,JWT_SECRET:jwt,NODE_ENV:'production',AUTH_COOKIE_SECURE:'false'}});
  await this.ready(base+'/api/health',id,signal);this.emit(id,'configure','Creating a protected connection and protected free-only routes…');
  await this.nineRequest(base,'/api/auth/login',signal,{method:'POST',body:{password}});
  await this.nineRequest(base,'/api/settings',signal,{method:'PATCH',body:{requireApiKey:true,requireLogin:true,cloudEnabled:false,tunnelEnabled:false,tunnelDashboardAccess:false,enableObservability:false,rtkEnabled:false,capacityAdapter:{vision:{enabled:false,models:[]},pdf:{enabled:false,models:[]},audioInput:{enabled:false,models:[]},videoInput:{enabled:false,models:[]}}}});
  const nodes=await this.nineRequest(base,'/api/provider-nodes',signal);let nodeInfo=nodes.nodes?.find(n=>n.prefix==='mico-free');
  if(nodeInfo){await this.nineRequest(base,'/api/provider-nodes/'+encodeURIComponent(nodeInfo.id),signal,{method:'PUT',body:{...nodeInfo,baseUrl:gatewayBase}})}
  else nodeInfo=(await this.nineRequest(base,'/api/provider-nodes',signal,{method:'POST',body:{name:'MicoCode free engine',prefix:'mico-free',apiType:'chat',type:'openai-compatible',baseUrl:gatewayBase}})).node;
  const {connections=[]}=await this.nineRequest(base,'/api/providers',signal);const existing=connections.find(c=>c.provider===nodeInfo.id);
  const routes=await this.managedRoutes(gatewayBase,signal);const preferred=this.preferredRoute(routes);
  const providerBody={provider:nodeInfo.id,name:'MicoCode free engine',apiKey:this.gatewayKey,defaultModel:preferred,testStatus:'active',isActive:true,lastError:null,lastErrorAt:null};
  await this.nineRequest(base,existing?'/api/providers/'+encodeURIComponent(existing.id):'/api/providers',signal,{method:existing?'PUT':'POST',body:providerBody});
  for(const route of routes){
   await this.nineRequest(base,'/api/models/custom',signal,{method:'POST',body:{providerAlias:'mico-free',id:route.id,name:route.name||route.id,type:'llm'}});
  }
  const {keys=[]}=await this.nineRequest(base,'/api/keys',signal);let key=keys.find(k=>k.name==='MicoCode desktop')?.key;
  if(!key)key=(await this.nineRequest(base,'/api/keys',signal,{method:'POST',body:{name:'MicoCode desktop'}})).key;
  if(!key)throw new Error('9Router did not create a connection key.');await this.vault.set('9router-client',key);
  return {config:{provider:'proxy',proxyPreset:id,proxyUrl:base+'/v1',model:'mico-free/'+preferred,freeModels:routes.map(r=>'mico-free/'+r.id),routerFreeOnly:true},key,dashboard:base+'/dashboard'};
 }
 async findExecutable(dir,names){
  for(const name of names){const file=path.join(dir,name);if(await exists(file))return file}
  for(const item of await readdir(dir,{withFileTypes:true})){if(item.isDirectory()){for(const name of names){const file=path.join(dir,item.name,name);if(await exists(file))return file}}}
  throw new Error('The official provider package did not contain its executable.');
 }
 async setupCLI(signal,gatewayBase){
  const id='cliproxy',dir=await this.installZip(id,artifacts[id],signal);const exe=await this.findExecutable(dir,['cli-proxy-api.exe','CLIProxyAPI.exe']);
  const port=await freePort(),key=await this.secret('cliproxy-client'),configFile=path.join(this.folder(id),'config.yaml');
  this.emit(id,'configure','Configuring CLIProxyAPI with every installed free model…');
  const routes=await this.managedRoutes(gatewayBase,signal);const preferred=this.preferredRoute(routes);
  await writeFile(configFile,cliProxyConfig(port,key,gatewayBase,this.gatewayKey,path.join(this.folder(id),'auth'),routes.map(r=>r.id)),{mode:0o600});
  this.emit(id,'start','Starting CLIProxyAPI on localhost…');this.start(id,exe,['--config',configFile],{cwd:dir});
  const base='http://127.0.0.1:'+port+'/v1';await this.ready(base+'/models',id,signal,{Authorization:'Bearer '+key});
  return {config:{provider:'proxy',proxyPreset:id,proxyUrl:base,model:preferred,freeModels:routes.map(r=>r.id),routerFreeOnly:true},key};
 }
 async setupLite(signal,gatewayBase){
  const id='litellm',dir=this.versionFolder(id),python=path.join(dir,'Scripts','python.exe');
  if(!await exists(path.join(dir,'Scripts','litellm.exe'))){
   const uvDir=path.join(this.root,'uv',artifacts.uv.version),zip=path.join(this.root,'downloads','uv.zip');
   if(!await exists(path.join(uvDir,'uv.exe'))){this.emit(id,'download','Downloading the verified private Python installer…');await downloadVerified(artifacts.uv,zip,signal,p=>this.emit(id,'download','Downloading uv from Astral’s official release…',p));await extractVerifiedZip(zip,uvDir,signal);await rm(zip,{force:true})}
   const uv=await this.findExecutable(uvDir,['uv.exe']);const env={UV_CACHE_DIR:path.join(this.root,'uv-cache'),UV_PYTHON_INSTALL_DIR:path.join(this.root,'python'),UV_NO_PROGRESS:'1',PYTHONNOUSERSITE:'1'};
   this.emit(id,'install','Installing private Python '+versions.python+' and LiteLLM '+versions.litellm+'…');
   await this.run(uv,['venv','--python',versions.python,'--managed-python',dir],{signal,env});
   await this.run(uv,['pip','install','--python',python,'litellm[proxy]=='+versions.litellm],{signal,env});
  }
  const port=await freePort(),key=await this.secret('litellm-client'),configFile=path.join(this.folder(id),'config.yaml');
  this.emit(id,'configure','Configuring LiteLLM with every installed free model and a private client key…');
  const routes=await this.managedRoutes(gatewayBase,signal);const preferred=this.preferredRoute(routes);
  await writeFile(configFile,liteLLMConfig(port,key,gatewayBase,this.gatewayKey,routes.map(r=>r.id)),{mode:0o600});
  this.emit(id,'start','Starting LiteLLM on localhost…');this.start(id,path.join(dir,'Scripts','litellm.exe'),['--config',configFile,'--host','127.0.0.1','--port',String(port)],{cwd:dir,env:{PYTHONNOUSERSITE:'1',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',LITELLM_TELEMETRY:'False',DO_NOT_TRACK:'1',LITELLM_MODE:'PRODUCTION'}});
  const base='http://127.0.0.1:'+port+'/v1';await this.ready(base+'/models',id,signal,{Authorization:'Bearer '+key});return {config:{provider:'proxy',proxyPreset:id,proxyUrl:base,model:preferred,freeModels:routes.map(r=>r.id),routerFreeOnly:true},key};
 }
 async setupOllama(signal){
  const id='ollama';await mkdir(this.folder(id),{recursive:true});let base=this.ollamaUpstream||'http://127.0.0.1:11434';let reusable=false;
  try{const r=await this.fetch(base+'/api/version',{signal:AbortSignal.any([signal,AbortSignal.timeout(2000)])});reusable=r.ok}catch{}
  if(!reusable){
   // Reuse a legitimate installed executable when available; otherwise install the official portable release privately.
   let exe=path.join(process.env.LOCALAPPDATA||'', 'Programs','Ollama','ollama.exe');
   if(!await exists(exe)){const dir=await this.installZip(id,artifacts[id],signal);exe=await this.findExecutable(dir,['ollama.exe'])}
   base='http://127.0.0.1:'+await freePort();this.emit(id,'start','Starting a private Ollama instance…');
   this.start(id,exe,['serve'],{env:{OLLAMA_HOST:base,OLLAMA_MODELS:path.join(this.folder(id),'models'),OLLAMA_ORIGINS:this.gatewayBase.split('/managed/')[0]}});await this.ready(base+'/api/version',id,signal);
  }
   this.ollamaUpstream=base;const r=await this.fetch(base+'/api/tags',{signal});const d=await r.json();
   const installed=(d.models||[]).map(m=>m?.name).filter(n=>typeof n==='string'&&n);
   let model=installed.find(n=>n.toLowerCase().includes('coder'))||installed[0];
  if(!model){
   this.emit(id,'download','Downloading Qwen 2.5 Coder 7B (about 4.7 GB). This powerful coding model runs free on your computer…');
   const pull=await this.fetch(base+'/api/pull',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:versions.model,stream:true}),signal});if(!pull.ok||!pull.body)throw new Error('Ollama could not download the coding model. Check available disk space and retry.');
   const reader=pull.body.getReader(),decoder=new TextDecoder();let pending='';
   while(true){const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let lineEnd;while((lineEnd=pending.indexOf('\n'))!==-1){const part=pending.slice(0,lineEnd);pending=pending.slice(lineEnd+1);if(!part.trim())continue;const state=JSON.parse(part);if(state.error)throw new Error('Ollama model download failed. Check your connection and disk space.');this.emit(id,'download',state.status?.startsWith('pulling')?'Downloading Qwen 2.5 Coder 7B to your computer…':state.status||'Preparing coding model…',state.total?Math.round(state.completed/state.total*100):undefined)}}
    model=versions.model;installed.push(model);
   }
   // Every installed model becomes a selectable managed route; the coder pick stays the default.
   const taken=new Set();this.ollamaModels=installed.map(name=>({name,route:routeSlug(name,taken)}));
   this.ollamaModel=model;this.emit(id,'configure','Connecting your local coding model through the built-in relay…');
  return {config:{provider:'ollama',ollamaUrl:this.gatewayBase.replace('/managed/v1','/managed/ollama'),model},key:''};
 }
}
