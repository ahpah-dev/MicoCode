import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,access,readdir,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
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
export function liteLLMConfig(port,key,base,upstreamKey){
 return `model_list:\n  - model_name: free-code\n    litellm_params:\n      model: openai/free-code\n      api_base: ${JSON.stringify(base)}\n      api_key: ${JSON.stringify(upstreamKey)}\n      timeout: 120\n      max_retries: 0\ngeneral_settings:\n  master_key: ${JSON.stringify(key)}\nlitellm_settings:\n  drop_params: true\n  num_retries: 0\n  request_timeout: 120\n`;
}
export function cliProxyConfig(port,key,base,upstreamKey,authDir){
 return `server:\n  host: 127.0.0.1\n  port: ${port}\naccess:\n  api-keys:\n    - ${JSON.stringify(key)}\nmanagement:\n  allow-remote: false\n  secret-key: \"\"\n  disable-control-panel: true\noauth:\n  auth-dir: ${JSON.stringify(authDir.replace(/\\/g,'/'))}\napi-keys:\n  openai-compatibility:\n    - name: micocode-community\n      base-url: ${JSON.stringify(base)}\n      keys:\n        - api-key: ${JSON.stringify(upstreamKey)}\n      models:\n        - name: free-code\n          alias: free-code\n          input-modalities: [text]\nrequests:\n  passthrough-headers: false\nobservability:\n  logs:\n    request-log: false\n    debug: false\n`;
}
export class ProviderManager{
 constructor({dataDir,runtimeDir,gatewayBase,gatewayKey,onProgress=()=>{},vault,fetchImpl=fetch,onDiagnostic=()=>{}}){
  this.root=path.join(dataDir,'providers');this.runtime=runtimeDir;this.gatewayBase=gatewayBase;this.gatewayKey=gatewayKey;
  this.notify=onProgress;this.vault=vault;this.fetch=fetchImpl;this.diagnostic=onDiagnostic;this.children=new Map();this.connections=new Map();this.active=null;this.cookies=new Map();this.ollamaUpstream=null;this.closing=false;
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
  child.stdout.on('data',log);child.stderr.on('data',log);child.on('error',e=>this.diagnostic(id,e.code||'Process start failed.'));child.once('exit',()=>{if(this.children.get(id)===child)this.children.delete(id)});
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
   const cached=this.connections.get(id);if(cached&&cached.config.routerEngine===engine&&hadChild?.exitCode===null){this.emit(id,'verify','Checking the running connection…');await this.verify(cached,signal);this.emit(id,'ready','Connected. Your free route is ready.');return cached}
   if(hadChild?.exitCode===null)await this.stop(id);
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
 async verify(connection,signal){
  const local=connection.config.provider==='ollama';const url=local?connection.config.ollamaUrl+'/api/tags':connection.config.proxyUrl+'/models';
  const r=await this.fetch(url,{headers:connection.key?{Authorization:'Bearer '+connection.key}:{},signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
  if(!r.ok)throw new Error('The installed provider did not accept its connection ('+r.status+'). Retry setup.');
  const d=await r.json();const ids=(d.data||d.models||[]).map(m=>m.id||m.name);if(!ids.includes(connection.config.model))throw new Error('The router did not expose the configured free model. Retry setup.');
 }
 async nineRequest(base,route,signal,{method='GET',body}={}){
  const r=await this.fetch(base+route,{method,headers:{'Content-Type':'application/json',Cookie:this.cookies.get('9router')||''},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
  const cookie=r.headers.get('set-cookie')?.split(';')[0];if(cookie)this.cookies.set('9router',cookie);
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error('9Router configuration could not finish ('+r.status+'). Retry setup.');return d;
 }
 async setupNine(signal,gatewayBase){
  const id='9router',dir=this.versionFolder(id),node=path.join(this.runtime,'node.exe');
  const appDir=path.join(dir,'node_modules','9router','app');
  if(!await exists(path.join(appDir,'server.js'))){
   this.emit(id,'install','Installing 9Router '+versions.nine+' with MicoCode’s bundled Node runtime…');await mkdir(dir,{recursive:true});
   await writeFile(path.join(dir,'package.json'),JSON.stringify({name:'mico-managed-9router',private:true,dependencies:{'9router':versions.nine}}));
   await this.run(node,[path.join(this.runtime,'node_modules','npm','bin','npm-cli.js'),'install','--ignore-scripts','--omit=dev','--no-audit','--no-fund','--registry=https://registry.npmjs.org/'],{cwd:dir,signal,env:{PATH:this.runtime+path.delimiter+process.env.PATH,npm_config_cache:path.join(this.root,'npm-cache')}});
  }
  const port=await freePort(),base='http://127.0.0.1:'+port;const password=await this.secret('9router-password'),jwt=await this.secret('9router-jwt');
  this.emit(id,'start','Starting your private 9Router on localhost…');
  const entry=await exists(path.join(appDir,'custom-server.js'))?'custom-server.js':'server.js';
  this.start(id,node,['--dns-result-order=ipv4first',path.join(appDir,entry)],{cwd:appDir,env:{PORT:String(port),HOSTNAME:'127.0.0.1',DATA_DIR:path.join(this.folder(id),'data'),INITIAL_PASSWORD:password,JWT_SECRET:jwt,NODE_ENV:'production',AUTH_COOKIE_SECURE:'false'}});
  await this.ready(base+'/api/health',id,signal);this.emit(id,'configure','Creating a protected connection and a protected free-only route…');
  await this.nineRequest(base,'/api/auth/login',signal,{method:'POST',body:{password}});
  await this.nineRequest(base,'/api/settings',signal,{method:'PATCH',body:{requireApiKey:true,requireLogin:true,cloudEnabled:false,tunnelEnabled:false,tunnelDashboardAccess:false,enableObservability:false,rtkEnabled:false,capacityAdapter:{vision:{enabled:false,models:[]},pdf:{enabled:false,models:[]},audioInput:{enabled:false,models:[]},videoInput:{enabled:false,models:[]}}}});
  const nodes=await this.nineRequest(base,'/api/provider-nodes',signal);let nodeInfo=nodes.nodes?.find(n=>n.prefix==='mico-free');
  if(nodeInfo){await this.nineRequest(base,'/api/provider-nodes/'+encodeURIComponent(nodeInfo.id),signal,{method:'PUT',body:{...nodeInfo,baseUrl:gatewayBase}})}
  else nodeInfo=(await this.nineRequest(base,'/api/provider-nodes',signal,{method:'POST',body:{name:'MicoCode free engine',prefix:'mico-free',apiType:'chat',type:'openai-compatible',baseUrl:gatewayBase}})).node;
  const {connections=[]}=await this.nineRequest(base,'/api/providers',signal);const existing=connections.find(c=>c.provider===nodeInfo.id);
  const providerBody={provider:nodeInfo.id,name:'MicoCode free engine',apiKey:this.gatewayKey,defaultModel:'free-code',testStatus:'active',isActive:true,lastError:null,lastErrorAt:null};
  await this.nineRequest(base,existing?'/api/providers/'+encodeURIComponent(existing.id):'/api/providers',signal,{method:existing?'PUT':'POST',body:providerBody});
  await this.nineRequest(base,'/api/models/custom',signal,{method:'POST',body:{providerAlias:'mico-free',id:'free-code',name:'Free coding engine',type:'llm'}});
  const {keys=[]}=await this.nineRequest(base,'/api/keys',signal);let key=keys.find(k=>k.name==='MicoCode desktop')?.key;
  if(!key)key=(await this.nineRequest(base,'/api/keys',signal,{method:'POST',body:{name:'MicoCode desktop'}})).key;
  if(!key)throw new Error('9Router did not create a connection key.');await this.vault.set('9router-client',key);
  return {config:{provider:'proxy',proxyPreset:id,proxyUrl:base+'/v1',model:'mico-free/free-code',freeModels:['mico-free/free-code'],routerFreeOnly:true},key,dashboard:base+'/dashboard'};
 }
 async findExecutable(dir,names){
  for(const name of names){const file=path.join(dir,name);if(await exists(file))return file}
  for(const item of await readdir(dir,{withFileTypes:true})){if(item.isDirectory()){for(const name of names){const file=path.join(dir,item.name,name);if(await exists(file))return file}}}
  throw new Error('The official provider package did not contain its executable.');
 }
 async setupCLI(signal,gatewayBase){
  const id='cliproxy',dir=await this.installZip(id,artifacts[id],signal);const exe=await this.findExecutable(dir,['cli-proxy-api.exe','CLIProxyAPI.exe']);
  const port=await freePort(),key=await this.secret('cliproxy-client'),configFile=path.join(this.folder(id),'config.yaml');
  this.emit(id,'configure','Configuring CLIProxyAPI with only the selected free engine…');
  await writeFile(configFile,cliProxyConfig(port,key,gatewayBase,this.gatewayKey,path.join(this.folder(id),'auth')),{mode:0o600});
  this.emit(id,'start','Starting CLIProxyAPI on localhost…');this.start(id,exe,['--config',configFile],{cwd:dir});
  const base='http://127.0.0.1:'+port+'/v1';await this.ready(base+'/models',id,signal,{Authorization:'Bearer '+key});
  return {config:{provider:'proxy',proxyPreset:id,proxyUrl:base,model:'free-code',freeModels:['free-code'],routerFreeOnly:true},key};
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
  this.emit(id,'configure','Configuring LiteLLM with a free-only route and a private client key…');await writeFile(configFile,liteLLMConfig(port,key,gatewayBase,this.gatewayKey),{mode:0o600});
  this.emit(id,'start','Starting LiteLLM on localhost…');this.start(id,path.join(dir,'Scripts','litellm.exe'),['--config',configFile,'--host','127.0.0.1','--port',String(port)],{cwd:dir,env:{PYTHONNOUSERSITE:'1',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',LITELLM_TELEMETRY:'False',DO_NOT_TRACK:'1',LITELLM_MODE:'PRODUCTION'}});
  const base='http://127.0.0.1:'+port+'/v1';await this.ready(base+'/models',id,signal,{Authorization:'Bearer '+key});return {config:{provider:'proxy',proxyPreset:id,proxyUrl:base,model:'free-code',freeModels:['free-code'],routerFreeOnly:true},key};
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
  let model=d.models?.find(m=>m.name.toLowerCase().includes('coder'))?.name||d.models?.[0]?.name;
  if(!model){
   this.emit(id,'download','Downloading Qwen Coder 1.5B (about 1 GB). This model runs free on your computer…');
   const pull=await this.fetch(base+'/api/pull',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:versions.model,stream:true}),signal});if(!pull.ok||!pull.body)throw new Error('Ollama could not download the coding model. Check available disk space and retry.');
   const reader=pull.body.getReader(),decoder=new TextDecoder();let pending='';
   while(true){const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let lineEnd;while((lineEnd=pending.indexOf('\n'))!==-1){const part=pending.slice(0,lineEnd);pending=pending.slice(lineEnd+1);if(!part.trim())continue;const state=JSON.parse(part);if(state.error)throw new Error('Ollama model download failed. Check your connection and disk space.');this.emit(id,'download',state.status?.startsWith('pulling')?'Downloading Qwen Coder to your computer…':state.status||'Preparing coding model…',state.total?Math.round(state.completed/state.total*100):undefined)}}
   model=versions.model;
  }
  this.ollamaModel=model;this.emit(id,'configure','Connecting your local coding model through the built-in relay…');
  return {config:{provider:'ollama',ollamaUrl:this.gatewayBase.replace('/managed/v1','/managed/ollama'),model},key:''};
 }
}
