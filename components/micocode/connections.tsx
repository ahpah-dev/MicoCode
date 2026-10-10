'use client';
import {useEffect,useRef,useState} from 'react';
import {Cpu,Cloud,Monitor,ArrowUpRight,Check,Download,LoaderCircle,ShieldCheck,Network,Zap,SlidersHorizontal,PackageCheck,Square,ExternalLink} from 'lucide-react';
import {Modal} from './primitives';
import {ModelPicker} from './model-picker';
import {browserReady,loadBrowserModel} from '@/lib/mico/agent';
import {applyManagedConnection,bestCodingModel,credentialSlot,discoverProxy,listProxyModels,proxyPresets,readCredential,recallProfile} from '@/lib/mico/providers.mjs';
import type {Config,ProxyPreset} from '@/lib/mico/types';
import {isManagedProvider,type ManagedProvider,type SetupProgress} from '@/lib/mico/desktop';

type Model={id:string;name:string;verified?:boolean;paid?:boolean;provider?:string;contextLength?:number;maxOutput?:number};
type Props={config:Config;setConfig:(c:Config,key?:string)=>void;apiKey:string;setKey:(s:string)=>void;onClose:()=>void;onReady:(s:string)=>void;locked?:boolean;restoring?:boolean};
export function Connections({config,setConfig,apiKey,setKey,onClose,onReady,locked=false,restoring=false}:Props){
 const [status,setStatus]=useState('');
 const [busy,setBusy]=useState(false);
 const [ok,setOk]=useState(false);
 const [models,setModels]=useState<Model[]>([]);
 const [refreshingModels,setRefreshingModels]=useState(false);
 const [localModels,setLocalModels]=useState<string[]>([]);
 const [progress,setProgress]=useState<SetupProgress|null>(null);
 const desktop=window.micoDesktop;
 const controller=useRef<AbortController|null>(null);
 const keyInput=useRef<HTMLInputElement>(null);
 const disabled=busy||locked||restoring;
 const preset=proxyPresets.find(p=>p.id===config.proxyPreset)!;
 const cloud=config.provider==='openrouter'||(config.provider==='proxy'&&!(desktop&&config.managed&&config.routerEngine==='local'));
 const update=(patch:Partial<Config>)=>{setConfig({...config,...patch});setStatus('');setOk(false)};
 function selectRouterModel(id:string){
  update({model:id});
  const selected=models.find(m=>m.id===id);
  if(selected){setOk(true);onReady(config.provider);setStatus('Selected '+selected.name+'. Model is listed by '+preset.name+'.')}
 }
 const visibleModels=models;
 const selectedPaid=config.proxyPreset!=='horde'&&!!models.find(m=>m.id===config.model.trim())?.paid;
 useEffect(()=>()=>controller.current?.abort(),[]);
 useEffect(()=>desktop?.onProgress(event=>setProgress(event)),[desktop]);
 useEffect(()=>{
  if(config.provider!=='openrouter')return;
  const abort=new AbortController();
  fetch('/api/models',{signal:abort.signal}).then(r=>r.json()).then(d=>{if(d.models)setModels(d.models);else setStatus(d.error)}).catch(()=>{if(!abort.signal.aborted)setStatus('Model discovery is unavailable. The free router remains selectable.')});
  return()=>abort.abort();
 },[config.provider]);
 function chooseProvider(provider:Config['provider']){
  if(provider===config.provider)return;
  const next=recallProfile({...config,provider,managed:false,model:provider==='openrouter'?'openrouter/free':provider==='ollama'?'qwen2.5-coder:3b':provider==='proxy'?'':config.model});
  setConfig(next);setModels([]);setStatus('');setOk(false);
 }
 function chooseProxy(id:string){
  if(config.provider==='proxy'&&id===config.proxyPreset)return config;
  const p=proxyPresets.find(p=>p.id===id)!;
  const next=recallProfile({...config,provider:'proxy',managed:false,proxyPreset:id as ProxyPreset,proxyUrl:p.url,model:'',freeModels:[],routerFreeOnly:false});
   setConfig(next);setModels([]);setStatus('');setOk(false);return next;
 }
 function useExistingNine(){
  const p=proxyPresets.find(item=>item.id==='9router')!;
  const saved=recallProfile({...config,provider:'proxy',proxyPreset:'9router' as ProxyPreset,proxyUrl:p.url,model:'',managed:false});
  const next={...saved,provider:'proxy' as const,proxyPreset:'9router' as const,proxyUrl:saved.managed?p.url:(saved.proxyUrl||p.url),model:'',managed:false,freeModels:[],routerFreeOnly:false};
  setConfig(next);setModels([]);setStatus('Using your 9Router. Enter its API key, then connect to load every enabled provider model and combo.');setOk(false);
 }
 async function refreshProxyModels(){
  if(disabled||config.provider!=='proxy')return;
  setRefreshingModels(true);
  try{
    const key=readCredential(config);
   const available:Model[]=await listProxyModels(config,key,AbortSignal.timeout(20000));
   setModels(available);
   const providers=new Set(available.map(m=>m.provider).filter(Boolean));
   setStatus(`Model catalogue refreshed · ${available.length} models${providers.size?` across ${providers.size} providers`:''}.`);
  }catch(e){setStatus((e as Error).message)}
  finally{setRefreshingModels(false)}
 }
 async function connect(candidate:Config=config,connectionKey?:string){
  if(disabled)return;
  if(desktop&&candidate.provider==='proxy'&&candidate.managed&&isManagedProvider(candidate.proxyPreset)){await setupNative(candidate.proxyPreset);return;}
  setBusy(true);setStatus('Connecting…');setOk(false);
  const abort=new AbortController();controller.current=abort;
  const timer=setTimeout(()=>abort.abort(),30000);
  try{
   if(candidate.provider==='browser'){
    clearTimeout(timer);await loadBrowserModel(candidate.browserSize,setStatus);
    if(abort.signal.aborted)return;
    setStatus('Ready. Inference runs on this device.');
   }else if(candidate.provider==='ollama'){
    const url=new URL(candidate.ollamaUrl);if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Use a loopback address for local Ollama.');
    const r=await fetch(candidate.ollamaUrl.replace(/\/$/,'')+'/api/tags',{signal:abort.signal});
    if(!r.ok)throw new Error('Ollama returned '+r.status);
    const d=await r.json();const names=(d.models||[]).map((m:{name:string})=>m.name);setLocalModels(names);
    if(!names.length)throw new Error('No installed model found. Use the local kit or run ollama pull qwen2.5-coder:3b.');
    setConfig({...candidate,model:names.includes(candidate.model)?candidate.model:names.find((s:string)=>s.includes('coder'))||names[0]});
    setStatus('Connected. '+names.length+' installed models found.');
   }else if(candidate.provider==='openrouter'){
    const key=connectionKey??(credentialSlot(candidate)===credentialSlot(config)?apiKey:readCredential(candidate));
    if(!key)throw new Error('Paste your own OpenRouter key, then connect.');
    const r=await fetch('/api/connection',{method:'POST',headers:{Authorization:'Bearer '+key},signal:abort.signal});
    const d=await r.json();if(!r.ok)throw new Error(d.error);
    setStatus(d.quota?'Connected. '+d.quota.remaining+' of '+d.quota.limit+' free requests remain today.':'Connected. Only zero-price routes are enabled; provider quotas apply.');
   }else{
     const key=connectionKey??(credentialSlot(candidate)===credentialSlot(config)?apiKey:readCredential(candidate));
     const available:Model[]=await listProxyModels(candidate,key,abort.signal);
     if(!available.length)throw new Error('No models found on this router. Retry later or type a model ID below.');
      setModels(available);
      const recommended=candidate.proxyPreset==='horde'?available.find(m=>m.id.includes('Llama-3.2-3B-Instruct'))?.id:undefined;
      const verified=available.filter(m=>m.verified);
      const providerCount=new Set(available.map(m=>m.provider).filter(Boolean)).size;
      const model=candidate.model.trim()||recommended||bestCodingModel(verified.length?verified:available);
     setConfig({...candidate,model});
     const declared=new Set(candidate.freeModels.map(s=>s.trim()).filter(Boolean));
     const pickedFree=available.find(m=>m.id===model)?.verified||(candidate.routerFreeOnly&&declared.has(model));
      const routerName=proxyPresets.find(p=>p.id===candidate.proxyPreset)?.name||'router';
      setStatus(candidate.proxyPreset==='horde'?'Connected. Active community models are available; volunteer queues and throughput vary.':'Connected to '+routerName+'. '+available.length+' model'+(available.length===1?'':'s')+(providerCount?' across '+providerCount+' providers':'')+' found'+(verified.length?' · '+verified.length+' report zero price':'')+'. '+(pickedFree?'Selected model reports zero price.':'Selected model pricing is controlled by your router and provider.'));
   }
   if(abort.signal.aborted)return;setOk(true);onReady(candidate.provider);
  }catch(e){if(!abort.signal.aborted)setStatus((e as Error).message);else setStatus('Connection stopped or timed out. Check your router, then try again.')}
  finally{clearTimeout(timer);setBusy(false);controller.current=null}
 }
 function quickConnect(id:string){
  if(desktop&&isManagedProvider(id)){void setupNative(id);return}
  const next=chooseProxy(id);
  // Anonymous Horde is the only preset that supplies an intentionally public key.
  // Other routers use the key saved for their exact URL, or their configured no-key mode.
  void connect(next);
 }
 async function setupNative(provider:ManagedProvider){
  if(disabled||!desktop)return;
  setBusy(true);setOk(false);setStatus('Preparing '+(provider==='9router'?'9Router':provider==='cliproxy'?'CLIProxyAPI':provider==='litellm'?'LiteLLM':'Ollama')+'…');setProgress({provider,stage:'install',message:'Preparing your private provider setup…'});
  try{
   const result=await desktop.setup(provider,config.routerEngine||'local');const next:Config=applyManagedConnection(config,result);
   setConfig(next,result.key);setModels([]);
   if(next.provider==='proxy'){
    const available:Model[]=await discoverProxy(next,result.key,AbortSignal.timeout(20000));setModels(available);
   }else{
    const r=await fetch(next.ollamaUrl+'/api/tags');const d=await r.json();setLocalModels((d.models||[]).map((m:{name:string})=>m.name));
   }
   setOk(true);onReady(next.provider);setStatus(provider==='ollama'||next.routerEngine==='local'?'Installed, started, and connected. Your coding model runs on this computer, with no service quota.':'Installed, started, and connected. The managed route uses free anonymous community compute. Availability and queue times vary.');
  }catch(e){setStatus((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /,''))}
  finally{setBusy(false)}
 }
 function cancel(){controller.current?.abort();if(progress&&desktop)void desktop.cancelSetup()}
 function downloadSetup(){const origin=location.origin.replace(/'/g,"''");const script=`# MicoCode local AI setup for Windows\n# Installs Ollama if missing, permits only your MicoCode origin, and downloads a coding model.\n$ErrorActionPreference = 'Stop'\nif (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {\n  winget install --id Ollama.Ollama --exact --accept-package-agreements --accept-source-agreements\n  if ($LASTEXITCODE -ne 0) { throw 'Ollama installation failed. Install from https://ollama.com/download and run this script again.' }\n  $env:Path += ';' + (Join-Path $env:LOCALAPPDATA 'Programs\\Ollama')\n}\n$micoOrigin = '${origin}'\n$priorOrigins = [Environment]::GetEnvironmentVariable('OLLAMA_ORIGINS','User')\n$micoOrigins = (@($priorOrigins -split ',' | Where-Object { $_ }) + @($micoOrigin) | Select-Object -Unique) -join ','\n[Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', $micoOrigins, 'User')\n$env:OLLAMA_ORIGINS = $micoOrigins\nif (Get-Process -Name ollama -ErrorAction SilentlyContinue) {\n  Write-Host 'Quit Ollama from the system tray, reopen it to load the allowed origin, then press Enter.'\n  Read-Host | Out-Null\n} else {\n  Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden\n  Start-Sleep -Seconds 4\n}\nollama pull qwen2.5-coder:3b\nif ($LASTEXITCODE -ne 0) { throw 'Model download failed. Check Ollama is running, then retry.' }\nWrite-Host 'Ready. Return to MicoCode, choose Ollama, and click Connect.'\n`;
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([script],{type:'text/plain'}));a.download='micocode-setup.ps1';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}

  return <Modal title="Connect a model." subtitle="Use a local model or connect your own router to choose from its live model catalogue." onClose={()=>{if(busy&&progress&&desktop)void desktop.cancelSetup();onClose()}} wide>
   <div className="connection-summary"><span><ShieldCheck size={14}/> Your providers, your keys</span><span><Zap size={14}/> Smart limit handling</span><span><SlidersHorizontal size={14}/> Review before applying</span></div>
  <div className="provider-grid">
    {([{id:'browser',name:'On device',sub:'No key · no service quota',Icon:Cpu},{id:'ollama',name:'Ollama',sub:'Your installed models',Icon:Monitor},{id:'openrouter',name:'OpenRouter',sub:'Free-tier models · provider limits apply',Icon:Cloud},{id:'proxy',name:'Your routers',sub:'9Router · LiteLLM · compatible APIs',Icon:Network}] as const).map(p=><button disabled={disabled} aria-pressed={config.provider===p.id} className={'provider-card '+(config.provider===p.id?'active':'')} key={p.id} onClick={()=>chooseProvider(p.id)}><p.Icon size={21}/><strong>{p.name}</strong><small>{p.sub}</small>{config.provider===p.id&&<Check className="provider-check" size={15}/>}</button>)}
  </div>
  <div className="connection-body">
   {config.provider==='proxy'?<>
     <div className="section-label">CONNECT YOUR MODEL ROUTER</div><h3>Bring all your models into one workspace.</h3>
     <p>{desktop?'Set up a private local route, or connect your own 9Router to use the providers and combos you already enabled.':'Connect to your own router to load its live model list, grouped by provider, with searchable model IDs and pricing details.'}</p>
     <div className="managed-intro"><PackageCheck size={20}/><div><strong>{desktop?(config.managed?'Private managed route':'Use your connected router'):'Connect your router'}</strong><p>{desktop?(config.managed?'Managed mode uses a private MicoCode router. Choose “Use existing 9Router” to access the providers you connected yourself.':'Models are loaded live from this router. Usage follows your connected providers and their limits.'):'Connect to your existing router; every model it exposes will appear in the searchable picker.'} {!desktop&&<a href="https://micocode.vercel.app/#downloads" target="_blank" rel="noreferrer">Download Windows app ↗</a>}</p></div></div>
    <>{desktop&&<label className="engine-choice">Managed router engine<select disabled={disabled} value={config.routerEngine||'local'} onChange={e=>update({routerEngine:e.target.value as 'local'|'community',model:''})}><option value="local">On this device · Ollama · no service quota</option><option value="community">Free community cloud · experimental</option></select><small className="field-help">{config.routerEngine==='community'?'Prompts go to AI Horde volunteer workers. Availability and queue times vary.':'Uses a private MicoCode router with local Ollama. To use your own 9Router providers, choose “Use existing 9Router” on its card.'}</small></label>}</><div className="router-grid">{proxyPresets.map(p=><article className={'router-card '+(config.proxyPreset===p.id?'active':'')} key={p.id}><button className="router-select" disabled={disabled} aria-pressed={config.proxyPreset===p.id} onClick={()=>chooseProxy(p.id)}><span className="router-monogram">{p.initial}</span><span><strong>{p.name}</strong><small>{p.description}</small></span>{config.proxyPreset===p.id&&<Check size={13}/>}</button><div className="router-card-footer"><span>{p.id==='horde'?'COMMUNITY':p.id==='custom'?'OPENAI-COMPATIBLE':desktop?'MANAGED':'SELF-HOSTED'}</span>{desktop&&p.id==='9router'&&<button className="existing-router-button" disabled={disabled} onClick={useExistingNine}>Use existing</button>}<button disabled={disabled} onClick={()=>quickConnect(p.id)} aria-label={(desktop&&isManagedProvider(p.id)?'Set up and connect ':'Connect ')+p.name}>{desktop&&isManagedProvider(p.id)?'Set up':'Connect'} <ArrowUpRight size={12}/></button></div></article>)}</div>
     {desktop&&config.managed&&config.proxyPreset==='9router'&&<div className="managed-actions"><div><strong>This private router exposes MicoCode’s managed engine.</strong><span className="muted">For your connected providers, use your existing 9Router instead.</span></div><button className="secondary" disabled={disabled} onClick={useExistingNine}>Use my 9Router <ArrowUpRight size={13}/></button><button className="secondary" disabled={disabled} onClick={()=>void desktop.openDashboard('9router').catch(e=>setStatus(e.message))}>Open private dashboard <ExternalLink size={13}/></button></div>}
    {config.proxyPreset==='horde'?<div className="info-box"><Cloud size={17}/><span>AI Horde uses volunteer compute and its documented anonymous access. No account or billing. Queues and model quality vary. Your prompt and requested files go to the community service. <a href={preset.docs} target="_blank" rel="noreferrer">Provider details ↗</a></span></div>:<>
     <div className="router-detail-heading"><strong>{preset.name} connection</strong><a href={preset.docs} target="_blank" rel="noreferrer">Setup guide <ArrowUpRight size={12}/></a></div>
     <label>OpenAI-compatible API base URL<input disabled={disabled} readOnly={!!desktop&&config.managed} value={config.proxyUrl} onChange={e=>{update({proxyUrl:e.target.value,managed:false,freeModels:[],routerFreeOnly:false,model:''});setModels([])}} placeholder="https://your-free-router.example/v1" autoComplete="off" spellCheck={false}/></label>
     <label>Router API key <span className="optional-field">if your router requires one</span><input ref={keyInput} disabled={disabled} type="password" readOnly={!!desktop&&config.managed} value={apiKey} onChange={e=>{setKey(e.target.value.trim());setOk(false)}} placeholder="Your own key · never shared across endpoints" autoComplete="off" spellCheck={false}/></label>
     {desktop&&config.managed?<div className="info-box managed-route"><ShieldCheck size={18}/><span><strong>Managed MicoCode routes</strong><br/>These use the private engine selected above. For models from your own providers, choose “Use existing” on the 9Router card.<br/>{models.length>0?<ModelPicker models={models} value={config.model} allowCustom={false} disabled={disabled} refreshing={refreshingModels} onRefresh={()=>void refreshProxyModels()} onChange={selectRouterModel}/>:<>Current route: <code>{config.model}</code><br/>Set up and connect to load available models.<br/></>}<button className="secondary" disabled={disabled} onClick={()=>update({managed:false})}>Configure this router manually</button></span></div>:<details className="router-advanced" open={!models.length}><summary>Model access and billing</summary><p>MicoCode lists every model ID exposed by this router. Access, pricing, provider limits, and fallbacks are controlled by your router and connected providers. Badges show pricing only when the router reports it.</p></details>}
     <p className="field-help">{desktop&&config.managed?'MicoCode configured this local connection automatically. The managed route is free; additional upstream accounts may require your own sign-in.':<>Requests go directly from your browser to this URL. Allow <code>{location.origin}</code> in the router’s CORS settings. Local routers may require local-network permission.</>}</p>
    </>}
       {!(desktop&&config.managed)&&<><ModelPicker models={visibleModels} value={config.model} disabled={disabled} refreshing={refreshingModels} onRefresh={()=>void refreshProxyModels()} onChange={selectRouterModel}/>{config.model.trim()&&models.length>0&&selectedPaid&&<p className="field-help">That route reports paid pricing. Your router controls billing; usage and provider limits apply.</p>}{config.proxyPreset==='9router'&&<details className="router-advanced model-help"><summary>How to show every 9Router model</summary><p>Connect the API key for your own 9Router instance. Its key must be unrestricted or allow the models you want. Enable provider connections and models in the 9Router dashboard, then refresh the catalogue. MicoCode displays the model IDs that 9Router returns.</p></details>}</>}
   </>:config.provider==='browser'?<>
    <div className="section-label">FREE, RIGHT HERE</div><h3>A coding model that stays with you.</h3><p>Download once, then generate on your GPU without a service quota. A recent Chrome or Edge with WebGPU is required. Speed and quality depend on your hardware.</p>
    <label>Model size<select disabled={disabled} value={config.browserSize} onChange={e=>update({browserSize:e.target.value as Config['browserSize']})}><option value="0.5B">Qwen Coder 0.5B · lightest</option><option value="1.5B">Qwen Coder 1.5B · balanced</option><option value="3B">Qwen Coder 3B · better quality</option></select></label>
    <div className="info-box"><Download size={17}/><span>First use downloads hundreds of MB to a few GB. Allow roughly 1–3 GB of GPU memory. Your browser caches the model.</span></div>
   </>:config.provider==='openrouter'?<>
    <div className="section-label">VERIFIED ZERO-PRICE ROUTING</div><h3>Free cloud, with a little less friction.</h3><p>Paste your key and connect. Automatic routing discovers free models; every request enforces a zero-price cap. Daily quotas still apply.</p>
    <label>OpenRouter API key<input ref={keyInput} disabled={disabled} type="password" value={apiKey} onChange={e=>{setKey(e.target.value.trim());setOk(false)}} placeholder="sk-or-…" autoComplete="off" spellCheck={false}/></label>
    <div className="field-help">Kept only in this tab’s session. Sent to the MicoCode relay and OpenRouter over HTTPS. <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">Get a free key <ArrowUpRight size={12}/></a></div>
    <label>Free model<select disabled={disabled} value={config.model} onChange={e=>update({model:e.target.value})}><option value="openrouter/free">Auto · OpenRouter free router</option>{models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
   </>:<>
    <div className="section-label">LOCAL MODELS, MORE ROOM</div><h3>Your machine is the engine.</h3><p>{desktop?'MicoCode finds your installed Ollama, or downloads a private copy. It uses an installed model or downloads Qwen Coder 1.5B automatically. No account or service quota.':'Connect the models already running in Ollama. The Windows setup script installs Ollama if needed and downloads Qwen Coder 3B.'}</p>
    <div className="two-fields"><label>Local address<input disabled={disabled} value={config.ollamaUrl} onChange={e=>update({ollamaUrl:e.target.value})}/></label><label>Model<input disabled={disabled} list="ollama-models" value={config.model} onChange={e=>update({model:e.target.value})}/><datalist id="ollama-models">{localModels.map(m=><option key={m}>{m}</option>)}</datalist></label></div>
    {desktop?<><button className="primary" disabled={disabled} onClick={()=>void setupNative('ollama')}><PackageCheck size={15}/> Set up & connect Ollama</button><p className="field-help">First setup may download a large runtime and about 1 GB for the model. MicoCode keeps its installation in your user profile and needs no administrator access.</p></>:<><button className="secondary" disabled={disabled} onClick={downloadSetup}><Download size={14}/> Download Windows setup</button><div className="field-help">Or <a href="/micocode-proxy.mjs" download>download the relay</a>, run <code>node micocode-proxy.mjs</code>, and connect to <code>http://127.0.0.1:11435</code>. <a href="https://docs.ollama.com/faq" target="_blank" rel="noreferrer">Ollama setup ↗</a></div></>}
   </>}
   {progress&&<div className="setup-progress" role="status"><div className="setup-stages">{(['download','install','start','configure','verify','ready'] as const).map(stage=><span key={stage} className={progress.stage===stage?'current':''}>{stage}</span>)}</div><p>{progress.message}</p>{progress.percent!==undefined&&<progress max={100} value={progress.percent} aria-label="Provider download progress"/>}{busy&&<button className="secondary" onClick={cancel}><Square size={12}/> Cancel setup</button>}</div>}
   <div className="connection-actions"><button className="primary" onClick={()=>void connect()} disabled={disabled}>{busy?<LoaderCircle size={16} className="spin"/>:ok?<Check size={16}/>:config.provider==='browser'?<Download size={16}/>:<Zap size={16}/>} {busy?'Connecting…':config.provider==='browser'?(browserReady(config.browserSize)?'Check model':'Download & load model'):'Connect & verify'}</button>{busy&&config.provider!=='browser'&&!progress&&<button className="secondary" onClick={cancel}>Cancel</button>}<span className="muted">{cloud?'Free routes · provider limits apply':'No service usage quota'}</span></div>
   {status&&<div role="status" className={'connection-status '+(ok?'success':'')}>{status}</div>}
   {locked&&<p className="field-help">Stop the current agent run to change connections.</p>}
   {restoring&&<p className="field-help" role="status">Restoring your managed connection. Setup will be available when it is ready.</p>}
   <details className="momentum-settings"><summary><SlidersHorizontal size={14}/> Momentum & code quality <span>Customize</span></summary>
    <label className="setting-switch"><input type="checkbox" disabled={disabled} checked={config.resilience} onChange={e=>update({resilience:e.target.checked})}/><span><strong>Smart limit handling</strong><small>Request pacing, reset-aware cooldowns, and up to two transient retries. Daily quota and billing errors stop immediately.</small></span></label>
    <label className="setting-switch"><input type="checkbox" disabled={disabled} checked={config.freeFallback} onChange={e=>update({freeFallback:e.target.checked})}/><span><strong>Free model fallback</strong><small>OpenRouter can switch to its free router when a selected free model is unavailable. Always zero price.</small></span></label>
    <label className="setting-switch"><input type="checkbox" disabled={disabled} checked={config.compactContext} onChange={e=>update({compactContext:e.target.checked})}/><span><strong>Lean context</strong><small>Trim older tool results, read file ranges, and make exact edits instead of rewriting whole files.</small></span></label>
    <label className="setting-switch"><input type="checkbox" disabled={disabled} checked={config.quality==='polished'} onChange={e=>update({quality:e.target.checked?'polished':'focused'})}/><span><strong>Polished code</strong><small>Design-aware instructions and a final static review for accessibility, mobile metadata, and broken resources.</small></span></label>
   </details>
  </div>
  <div className="connection-footer"><ShieldCheck size={14}/> Projects stay on this device. Cloud requests share your prompt and requested files with the connection you choose.</div>
 </Modal>;
}
