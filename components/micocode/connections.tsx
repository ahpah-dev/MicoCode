'use client';
import {useEffect,useRef,useState} from 'react';
import {Cpu,Cloud,Monitor,ArrowUpRight,Check,Download,LoaderCircle,ShieldCheck,Network,Zap,SlidersHorizontal,PackageCheck,Square,ExternalLink} from 'lucide-react';
import {Modal} from './primitives';
import {ModelPicker} from './model-picker';
import {Dropdown} from './dropdown';
import {groupOptionsByPrefix} from '@/lib/mico/interface';
import {browserReady,loadBrowserModel} from '@/lib/mico/agent';
import {discoverLocalNineKey,pickWorkingCodingModel,rankCodingModels} from '@/lib/mico/auto-connect.mjs';
import {applyManagedConnection,credentialSlot,discoverProxy,listProxyModels,proxyPresets,readCredential,recallProfile,selectCatalogueModel} from '@/lib/mico/providers.mjs';
import type {Config,ProxyPreset} from '@/lib/mico/types';
import {isManagedProvider,type ManagedProvider,type SetupProgress} from '@/lib/mico/desktop';

type Model={id:string;name:string;verified?:boolean;paid?:boolean;provider?:string;contextLength?:number;maxOutput?:number;catalogueSource?:string;accessUnchecked?:boolean};
type Catalogue=Model[]&{catalogueWarning?:string};
type Props={config:Config;setConfig:(c:Config,key?:string)=>void;apiKey:string;setKey:(s:string)=>void;onClose:()=>void;onReady:(s:string)=>void;locked?:boolean;restoring?:boolean};
export function Connections({config,setConfig,apiKey,setKey,onClose,onReady,locked=false,restoring=false}:Props){
 const [status,setStatus]=useState('');
 const [busy,setBusy]=useState(false);
 const [ok,setOk]=useState(false);
 const [models,setModels]=useState<Model[]>([]);
 const [catalogueWarning,setCatalogueWarning]=useState('');
 const [refreshingModels,setRefreshingModels]=useState(false);
  const [localModels,setLocalModels]=useState<string[]>([]);
  const [freeRideKeys,setFreeRideKeys]=useState({nvidiaApiKey:'',openRouterApiKey:'',groqApiKey:'',huggingFaceToken:'',cerebrasApiKey:'',cloudflareApiToken:'',cloudflareAccountId:''});
 const [progress,setProgress]=useState<SetupProgress|null>(null);
 const desktop=window.micoDesktop;
 const [autoScanning,setAutoScanning]=useState(false);

 async function runAutoDetect(){
  if(disabled||autoScanning)return;
  setAutoScanning(true);setStatus('Scanning localhost for AI routers and coding models…');
  try{
   for(const router of [{id:'9router',health:'http://127.0.0.1:20128/api/health'},{id:'freeride',health:'http://127.0.0.1:11343/health'}]){
    try{
     const res=await fetch(router.health,{signal:AbortSignal.timeout(1500)});
     if(!res.ok)continue;
     const preset=proxyPresets.find(p=>p.id===router.id)!;
     const base:Config={...config,provider:'proxy',proxyPreset:router.id as ProxyPreset,proxyUrl:preset.url,managed:false,freeModels:[],routerFreeOnly:false,model:''};
     let key=readCredential(base),keyNote='';
     if(!key&&router.id==='9router'){
      const found=await discoverLocalNineKey();
      if(found){key=found.key;keyNote=` using router key “${found.name}”`}
     }
     setStatus(`Found ${preset.name}. Loading models and probing the strongest coding route…`);
     const available:Catalogue=await listProxyModels(base,key,AbortSignal.timeout(15000));
     receiveCatalogue(available);
     const chosen=await pickWorkingCodingModel({base:preset.url,key,models:available,signal:AbortSignal.timeout(90000),onProgress:(m:string)=>setStatus(`${preset.name}: ${m}…`)});
     if(chosen){
      const next:Config={...base,model:chosen};
      setConfig(next,key||undefined);setOk(true);onReady('proxy');
      setStatus(`Auto-configured ${preset.name} with ${chosen}${keyNote} (${available.length} models loaded).`);
      return;
     }
    }catch{}
   }
   for(const port of [11434,11435]){
    try{
     const url=`http://127.0.0.1:${port}`;
     const res=await fetch(`${url}/api/tags`,{signal:AbortSignal.timeout(2000)});
     if(res.ok){
      const d=await res.json();
      const names=(d.models||[]).map((m:{name:string})=>m.name);
      if(names.length){
       setLocalModels(names);
       const best=rankCodingModels(names)[0]||names[0];
       const next:Config={...config,provider:'ollama',ollamaUrl:url,model:best};
       setConfig(next);setOk(true);onReady('ollama');
       setStatus(`Auto-configured: connected to local Ollama (port ${port}) with ${best}.`);
       return;
      }
     }
    }catch{}
   }
   setStatus('No local engines detected on localhost. Start 9Router or Ollama ("ollama serve"), or choose a provider below.');
  }catch(e){
   setStatus((e as Error).message);
  }finally{
   setAutoScanning(false);
  }
 }
 const controller=useRef<AbortController|null>(null);
 const catalogueController=useRef<AbortController|null>(null);
 const customSelection=useRef<{scope:string;id:string}|null>(null);
 const keyInput=useRef<HTMLInputElement>(null);
 const disabled=busy||locked||restoring;
 const preset=proxyPresets.find(p=>p.id===config.proxyPreset)!;
 const cloud=config.provider==='openrouter'||(config.provider==='proxy'&&!(desktop&&config.managed&&config.routerEngine==='local'&&config.freeModels.includes(config.model)));
 const update=(patch:Partial<Config>)=>{catalogueController.current?.abort();setRefreshingModels(false);setConfig({...config,...patch});setStatus('');setOk(false)};
 const receiveCatalogue=(available:Catalogue)=>{setModels(available);setCatalogueWarning(available.catalogueWarning||'')};
 function selectRouterModel(id:string){
  customSelection.current=models.some(m=>m.id===id)?null:{scope:config.proxyPreset+'|'+config.proxyUrl,id};
  update({model:id});
  const selected=models.find(m=>m.id===id);
  if(selected){setOk(true);onReady(config.provider);setStatus('Selected '+selected.name+'. '+(selected.catalogueSource==='opencode-live'?'Discovered in OpenCode’s live free catalogue. Access through your router and key is unchecked until you send a prompt.':'The model is listed by '+preset.name+'; provider access is checked when you send a prompt.'))}
 }
 const visibleModels=models;
 const selectedPaid=config.proxyPreset!=='horde'&&!!models.find(m=>m.id===config.model.trim())?.paid;
 useEffect(()=>()=>{controller.current?.abort();catalogueController.current?.abort()},[]);
 useEffect(()=>desktop?.onProgress(event=>setProgress(event)),[desktop]);
 useEffect(()=>{
  if(!['proxy','openrouter'].includes(config.provider)||restoring||locked||busy)return;
   if(config.provider==='proxy'&&!config.proxyUrl)return;
   // Before native FreeRide setup completes, its public default port may not
   // exist. Keep the setup/key error instead of overwriting it with CORS advice.
   if(desktop&&config.provider==='proxy'&&config.proxyPreset==='freeride'&&!config.managed)return;
  const abort=new AbortController();
  catalogueController.current?.abort();catalogueController.current=abort;
  setModels([]);setCatalogueWarning('');setRefreshingModels(true);
  const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(20000)]);
  const request=config.provider==='proxy'?listProxyModels(config,apiKey,signal):fetch('/api/models',{signal}).then(async r=>{const d=await r.json();if(!r.ok||!Array.isArray(d.models))throw new Error(d.error||'Free model discovery is unavailable. The free router remains selectable.');return d.models});
  request.then((available:Catalogue)=>{if(!abort.signal.aborted&&catalogueController.current===abort)receiveCatalogue(available)})
   .catch(e=>{if(!abort.signal.aborted&&catalogueController.current===abort)setStatus(e.name==='TimeoutError'?'Model discovery timed out. Refresh the catalogue to try again.':e.message)})
   .finally(()=>{if(!abort.signal.aborted&&catalogueController.current===abort)setRefreshingModels(false)});
  return()=>abort.abort();
 },[config.provider,config.proxyPreset,config.proxyUrl,config.managed,apiKey,restoring,locked,busy]);
 function chooseProvider(provider:Config['provider']){
  if(provider===config.provider)return;
  catalogueController.current?.abort();customSelection.current=null;
  const next=recallProfile({...config,provider,managed:false,model:provider==='openrouter'?'openrouter/free':provider==='ollama'?'qwen3.5:9b':provider==='proxy'?'':config.model});
  setConfig(next);setModels([]);setCatalogueWarning('');setRefreshingModels(false);setStatus('');setOk(false);
 }
 function chooseProxy(id:string){
  if(config.provider==='proxy'&&id===config.proxyPreset)return config;
  catalogueController.current?.abort();customSelection.current=null;
  const p=proxyPresets.find(p=>p.id===id)!;
  const next=recallProfile({...config,provider:'proxy',managed:false,proxyPreset:id as ProxyPreset,proxyUrl:p.url,model:'',freeModels:[],routerFreeOnly:false});
   setConfig(next);setModels([]);setCatalogueWarning('');setRefreshingModels(false);setStatus('');setOk(false);return next;
 }
 function useExistingNine(){
  catalogueController.current?.abort();customSelection.current=null;
  const p=proxyPresets.find(item=>item.id==='9router')!;
  const saved=recallProfile({...config,provider:'proxy',proxyPreset:'9router' as ProxyPreset,proxyUrl:p.url,model:'',managed:false});
  const next={...saved,provider:'proxy' as const,proxyPreset:'9router' as const,proxyUrl:saved.managed?p.url:(saved.proxyUrl||p.url),model:'',managed:false,freeModels:[],routerFreeOnly:false};
  const key=readCredential(next);setConfig(next,key||undefined);setModels([]);setCatalogueWarning('');setOk(false);if(key){void connect(next,key);return}void discoverLocalNineKey().then(found=>{if(found?.key){setConfig(next,found.key);void connect(next,found.key)}else setStatus('Using your 9Router. Enter its API key, then connect to load every enabled provider model and combo.')});
 }
  async function refreshProxyModels(){
   if(disabled||config.provider!=='proxy')return;
   if(desktop&&config.proxyPreset==='freeride'&&!config.managed){await setupNative('freeride');return}
  const abort=new AbortController();catalogueController.current?.abort();catalogueController.current=abort;
  setRefreshingModels(true);
  try{
   let candidate=config,key=apiKey,warning='';
   if(desktop&&config.managed&&config.proxyPreset==='9router'){
    const result=await desktop.refreshModels();
    if(abort.signal.aborted||catalogueController.current!==abort)return;
    candidate=applyManagedConnection(config,result);key=result.key;warning=result.catalogueWarning||'';
    setConfig(candidate,key);onReady(candidate.provider);
   }
   const available:Catalogue=await listProxyModels(candidate,key,AbortSignal.any([abort.signal,AbortSignal.timeout(20000)]));
   if(abort.signal.aborted||catalogueController.current!==abort)return;
   receiveCatalogue(available);
   const providers=new Set(available.map(m=>m.provider).filter(Boolean));
   setStatus(`Model catalogue refreshed · ${available.length} models${providers.size?` across ${providers.size} providers`:''}.`+(warning?' '+warning:''));
  }catch(e){if(!abort.signal.aborted&&catalogueController.current===abort)setStatus((e as Error).message)}
  finally{if(!abort.signal.aborted&&catalogueController.current===abort)setRefreshingModels(false)}
 }
 async function connect(candidate:Config=config,connectionKey?:string){
  if(disabled)return;
   if(desktop&&candidate.managed&&candidate.provider==='ollama'){await setupNative('ollama');return;}
    if(desktop&&candidate.provider==='proxy'&&(candidate.proxyPreset==='freeride'||candidate.managed&&isManagedProvider(candidate.proxyPreset))){await setupNative(candidate.proxyPreset as ManagedProvider);return;}
  catalogueController.current?.abort();setRefreshingModels(false);
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
    let r:Response;
    try{r=await fetch(candidate.ollamaUrl.replace(/\/$/,'')+'/api/tags',{signal:abort.signal})}catch{throw new Error(`Could not connect to Ollama at ${candidate.ollamaUrl}. Make sure Ollama is running ('ollama serve') or click Zero-Config Auto-Detect above.`)}
    if(!r.ok)throw new Error('Ollama returned '+r.status);
    const d=await r.json();const names=(d.models||[]).map((m:{name:string})=>m.name);setLocalModels(names);
    if(!names.length)throw new Error('No installed model found. Use the local kit or run ollama pull qwen3.5:9b.');
    setConfig({...candidate,model:names.includes(candidate.model)?candidate.model:rankCodingModels(names)[0]||names[0]});
    setStatus('Connected. '+names.length+' installed models found.');
   }else if(candidate.provider==='openrouter'){
    const key=connectionKey??(credentialSlot(candidate)===credentialSlot(config)?apiKey:readCredential(candidate));
    if(!key)throw new Error('Paste your own OpenRouter key, then connect.');
    const r=await fetch('/api/connection',{method:'POST',headers:{Authorization:'Bearer '+key},signal:abort.signal});
    const d=await r.json();if(!r.ok)throw new Error(d.error);
    setStatus(d.quota?'Connected. '+d.quota.remaining+' of '+d.quota.limit+' free requests remain today.':'Connected. Only zero-price routes are enabled; provider quotas apply.');
   }else{
     let key=connectionKey??(credentialSlot(candidate)===credentialSlot(config)?apiKey:readCredential(candidate));if(!key&&candidate.proxyPreset==='9router'&&!candidate.managed){const found=await discoverLocalNineKey();if(found?.key){key=found.key;setKey(key)}}
      if(candidate.proxyPreset==='opencode'&&!key)throw new Error('Paste your own OpenCode Zen API key. The public model list does not grant access to generation.');
      if(candidate.proxyPreset==='aihubmix'&&!key)throw new Error('Paste your AIHubMix API key from aihubmix.com to load its live model catalogue.');
      if(candidate.proxyPreset==='nim'&&!key)throw new Error('Paste your NVIDIA NIM API key from NVIDIA Build to load its live model catalogue.');
      if(candidate.proxyPreset==='aistudio'&&!key)throw new Error('Paste your Google AI Studio API key from aistudio.google.com/apikey to load its live Gemini model catalogue.');
     const available:Catalogue=await listProxyModels(candidate,key,abort.signal);
     if(!available.length)throw new Error('No models found on this router. Retry later or type a model ID below.');
      receiveCatalogue(available);
       const recommended=candidate.proxyPreset==='freeride'?'freeride/auto':candidate.proxyPreset==='horde'?available.find(m=>/muse-spark|glm-?5|gemma-?4|qwen3|deepseek-v4|kimi|nemotron|devstral|coder/i.test(m.id))?.id:undefined;
      const verified=available.filter(m=>m.verified);
      const providerCount=new Set(available.map(m=>m.provider).filter(Boolean)).size;
      const custom=customSelection.current;
      const model=selectCatalogueModel(available,candidate.model,{preferred:recommended,allowCustom:!!custom&&custom.scope===candidate.proxyPreset+'|'+candidate.proxyUrl&&custom.id===candidate.model.trim()});
     setConfig({...candidate,model});
     const declared=new Set(candidate.freeModels.map(s=>s.trim()).filter(Boolean));
     const selectedModel=available.find(m=>m.id===model);
     const pickedFree=selectedModel?.verified||(candidate.routerFreeOnly&&declared.has(model));
      const routerName=proxyPresets.find(p=>p.id===candidate.proxyPreset)?.name||'router';
      setStatus(candidate.proxyPreset==='opencode'?'OpenCode Zen configured. '+available.length+' verified free models are available. Your key and model access are checked when you send a prompt.':candidate.proxyPreset==='horde'?'Connected. Active community models are available; volunteer queues and throughput vary.':'Connected to '+routerName+'. '+available.length+' model'+(available.length===1?'':'s')+(providerCount?' across '+providerCount+' providers':'')+' found'+(verified.length?' · '+verified.length+' report zero price':'')+'. '+(pickedFree?'Selected model reports zero price.':'Selected model pricing is controlled by your router and provider.'));
      if(selectedModel?.catalogueSource==='opencode-live')setStatus('Router catalogue connected. '+available.length+' models available. Selected '+selectedModel.name+' was discovered in OpenCode’s live free catalogue; access through your router and key is unchecked until you send a prompt.');
   }
   if(abort.signal.aborted)return;setOk(true);onReady(candidate.provider);
  }catch(e){if(!abort.signal.aborted)setStatus((e as Error).message);else setStatus('Connection stopped or timed out. Check your router, then try again.')}
  finally{clearTimeout(timer);setBusy(false);controller.current=null}
 }
  function quickConnect(id:string){
   const next=chooseProxy(id);
   if(desktop&&isManagedProvider(id)){void setupNative(id);return}
   if(id==='nim'&&!readCredential(next)){setStatus('Add your NVIDIA Build API key below, then click Connect & verify.');setTimeout(()=>keyInput.current?.focus(),0);return}
   if(id==='aistudio'&&!readCredential(next)){setStatus('Add your Google AI Studio API key below, then click Connect & verify.');setTimeout(()=>keyInput.current?.focus(),0);return}
   if(id==='aihubmix'&&!readCredential(next)){setStatus('Add your AIHubMix API key below, then click Connect & verify.');setTimeout(()=>keyInput.current?.focus(),0);return}
  // Anonymous Horde is the only preset that supplies an intentionally public key.
  // Other routers use the key saved for their exact URL, or their configured no-key mode.
  void connect(next);
 }
  async function setupNative(provider:ManagedProvider){
   if(disabled||!desktop)return;
   catalogueController.current?.abort();setRefreshingModels(false);
   const name=provider==='9router'?'9Router':provider==='cliproxy'?'CLIProxyAPI':provider==='litellm'?'LiteLLM':provider==='freeride'?'FreeRide':'Ollama';
   setBusy(true);setOk(false);setStatus('Preparing '+name+'…');setProgress({provider,stage:'install',message:'Preparing your private provider setup…'});
   try{
    const nimPreset=proxyPresets.find(p=>p.id==='nim')!;
    const freerideCredentials=provider==='freeride'?{...freeRideKeys,nvidiaApiKey:freeRideKeys.nvidiaApiKey||readCredential({provider:'proxy',proxyPreset:'nim',proxyUrl:nimPreset.url}),openRouterApiKey:freeRideKeys.openRouterApiKey||readCredential({provider:'openrouter'})}:undefined;
    const result=await desktop.setup(provider,provider==='freeride'?'community':config.routerEngine||'local',freerideCredentials);const next:Config=applyManagedConnection(config,result);
    if(provider==='freeride')setFreeRideKeys({nvidiaApiKey:'',openRouterApiKey:'',groqApiKey:'',huggingFaceToken:'',cerebrasApiKey:'',cloudflareApiToken:'',cloudflareAccountId:''});
    setConfig(next,result.key);setModels([]);
    if(next.provider==='proxy'){
      const available:Catalogue=await discoverProxy(next,result.key,AbortSignal.timeout(20000));receiveCatalogue(available);
      if(next.proxyPreset==='9router')setStatus('Connected to 9Router. '+available.length+' router-listed and discovered provider models are available. Provider access is checked when you send a prompt.'+(result.catalogueWarning?' '+result.catalogueWarning:''));
      if(next.proxyPreset==='freeride')setStatus('FreeRide ready. '+available.length+' free-tier routes are available with automatic provider failover.');
    }else{
    const r=await fetch(next.ollamaUrl+'/api/tags');const d=await r.json();setLocalModels((d.models||[]).map((m:{name:string})=>m.name));
   }
     setOk(true);onReady(next.provider);if(provider!=='freeride'&&(next.proxyPreset!=='9router'||next.provider!=='proxy'))setStatus(provider==='ollama'||next.routerEngine==='local'?'Installed, started, and connected. Your coding model runs on this computer, with no service quota.':'Installed, started, and connected. The managed route uses free anonymous community compute. Availability and queue times vary.');
   }catch(e){setStatus((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /,''));setProgress(null)}
  finally{setBusy(false)}
 }
 function cancel(){controller.current?.abort();if(progress&&desktop)void desktop.cancelSetup()}
  function downloadSetup(){const origin=location.origin.replace(/'/g,"''");const script=`# MicoCode local AI setup for Windows\n# Installs Ollama if missing, permits only your MicoCode origin, and downloads a coding model.\n$ErrorActionPreference = 'Stop'\nif (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {\n  winget install --id Ollama.Ollama --exact --accept-package-agreements --accept-source-agreements\n  if ($LASTEXITCODE -ne 0) { throw 'Ollama installation failed. Install from https://ollama.com/download and run this script again.' }\n  $env:Path += ';' + (Join-Path $env:LOCALAPPDATA 'Programs\\Ollama')\n}\n$micoOrigin = '${origin}'\n$priorOrigins = [Environment]::GetEnvironmentVariable('OLLAMA_ORIGINS','User')\n$micoOrigins = (@($priorOrigins -split ',' | Where-Object { $_ }) + @($micoOrigin) | Select-Object -Unique) -join ','\n[Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', $micoOrigins, 'User')\n$env:OLLAMA_ORIGINS = $micoOrigins\nif (Get-Process -Name ollama -ErrorAction SilentlyContinue) {\n  Write-Host 'Quit Ollama from the system tray, reopen it to load the allowed origin, then press Enter.'\n  Read-Host | Out-Null\n} else {\n  Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden\n  Start-Sleep -Seconds 4\n}\nollama pull qwen3.5:9b\nif ($LASTEXITCODE -ne 0) { throw 'Model download failed. Check Ollama is running, then retry.' }\nWrite-Host 'Ready. Return to MicoCode, choose Ollama, and click Connect.'\n`;
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([script],{type:'text/plain'}));a.download='micocode-setup.ps1';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}

  return <Modal title="Connect a model." subtitle="Use a local model or connect your own router to choose from its live model catalogue." onClose={()=>{if(busy&&progress&&desktop)void desktop.cancelSetup();onClose()}} wide>
   <div className="connection-summary"><span><ShieldCheck size={14}/> Your providers, your keys</span><span><Zap size={14}/> Smart limit handling</span><span><SlidersHorizontal size={14}/> Review before applying</span></div>
   <div className="auto-detect-card">
    <div className="auto-detect-header">
     <div className="auto-detect-title"><Zap size={16}/><span>Zero-Config Auto-Detect</span></div>
     <span className="auto-detect-badge">RECOMMENDED</span>
    </div>
    <p className="auto-detect-desc">Automatically scan localhost for running 9Router (port 20128), FreeRide (11343), or Ollama (11434/11435), retrieve or generate API keys, and select the strongest working coding model.</p>
    <button type="button" className="primary auto-detect-btn" disabled={disabled||autoScanning} onClick={runAutoDetect}>{autoScanning?<LoaderCircle size={15} className="spin"/>:<Zap size={15}/>}<span>{autoScanning?'Scanning localhost…':'Auto-Detect & Connect Everything'}</span></button>
   </div>
  <div className="provider-grid">
    {([{id:'browser',name:'On device',sub:'No key · no service quota',Icon:Cpu},{id:'ollama',name:'Ollama',sub:'Your installed models',Icon:Monitor},{id:'openrouter',name:'OpenRouter',sub:'Free-tier models · provider limits apply',Icon:Cloud},{id:'proxy',name:'Your routers',sub:'9Router, OmniRoute and more',Icon:Network}] as const).map(p=><button disabled={disabled} aria-pressed={config.provider===p.id} className={'provider-card '+(config.provider===p.id?'active':'')} key={p.id} onClick={()=>chooseProvider(p.id)}><p.Icon size={21}/><strong>{p.name}</strong><small>{p.sub}</small>{config.provider===p.id&&<Check className="provider-check" size={15}/>}</button>)}
  </div>
  <div className="connection-body">
   {config.provider==='proxy'?<>
     <div className="section-label">CONNECT YOUR MODEL ROUTER</div><h3>Bring all your models into one workspace.</h3>
     <p>{desktop?'Set up a private local route, or connect your own 9Router to use the providers and combos you already enabled.':'Connect to your own router to load its live model list, grouped by provider, with searchable model IDs and pricing details.'}</p>
       <div className="managed-intro"><PackageCheck size={20}/><div><strong>{config.proxyPreset==='9router'&&config.managed?'MicoCode’s private 9Router':config.proxyPreset==='9router'?'Your 9Router catalogue':'Use your connected router'}</strong><p>{config.proxyPreset==='9router'?(config.managed?'This private instance is separate from your own 9Router and does not import its provider accounts. Choose “Use existing” to connect that router.':'Loads every model and combo allowed for this API key. If a provider reaches its quota, select another enabled provider model below; MicoCode will not switch providers automatically.'):'Models are loaded live from '+((proxyPresets.find(p=>p.id===config.proxyPreset)||{}).name||'this router')+'. Usage follows your connected providers and their limits.'} {!desktop&&<a href="https://micocode.vercel.app/#downloads" target="_blank" rel="noreferrer">Download Windows app ↗</a>}</p></div></div>
      <>{desktop&&isManagedProvider(config.proxyPreset)&&config.proxyPreset!=='freeride'&&<label className="engine-choice">Managed router engine<Dropdown label="Managed router engine" disabled={disabled} value={config.routerEngine||'local'} onChange={value=>update({routerEngine:value as 'local'|'community',model:''})} options={[{value:'local',label:'On this device · Ollama · no service quota'},...(config.routerEngine==='community'?[{value:'community',label:'Saved legacy AI Horde setup'}]:[])]}/><small className="field-help">Uses a private MicoCode router with local Ollama.{config.proxyPreset==='9router'?' To use your own 9Router providers, choose “Use existing 9Router” on its card.':''}</small></label>}</><div className="router-grid">{proxyPresets.filter(p=>!p.hidden).map(p=><article className={'router-card '+(config.proxyPreset===p.id?'active':'')} key={p.id}><button className="router-select" disabled={disabled} aria-pressed={config.proxyPreset===p.id} onClick={()=>chooseProxy(p.id)}><span className="router-monogram">{p.initial}</span><span><strong>{p.name}</strong><small>{p.description}</small></span>{config.proxyPreset===p.id&&<Check size={13}/>}</button><div className="router-card-footer"><span>{p.id==='freeride'?'AUTO-FAILOVER':p.id==='aistudio'?'GOOGLE CLOUD':p.id==='aihubmix'?'MULTI-PROVIDER':p.id==='nim'?'NVIDIA CLOUD':p.id==='custom'?'OPENAI-COMPATIBLE':desktop&&isManagedProvider(p.id)?'MANAGED':'SELF-HOSTED'}</span>{desktop&&p.id==='9router'&&<button className="existing-router-button" disabled={disabled} onClick={useExistingNine}>Use existing</button>}<button disabled={disabled} onClick={()=>quickConnect(p.id)} aria-label={(desktop&&isManagedProvider(p.id)?'Set up and connect ':'Connect ')+p.name}>{desktop&&isManagedProvider(p.id)?'Set up':'Connect'} <ArrowUpRight size={12}/></button></div></article>)}</div>
       {desktop&&config.managed&&config.proxyPreset==='9router'&&<div className="managed-actions"><div><strong>MicoCode’s private 9Router (local routes only).</strong><span className="muted">It cannot see accounts configured in your other 9Router. Choose Use existing to load that instance’s providers.</span></div><button className="secondary" disabled={disabled} onClick={()=>void desktop.openDashboard('9router').catch(e=>setStatus(e.message))}>Open private dashboard <ExternalLink size={13}/></button><button className="secondary" disabled={disabled} onClick={useExistingNine}>Use existing 9Router <ArrowUpRight size={13}/></button></div>}
       {desktop&&config.managed&&config.proxyPreset==='omniroute'&&<div className="managed-actions"><div><strong>OmniRoute · free models only.</strong><span className="muted">MicoCode installed it, started it, and created an access key locked to the free catalogue — this key cannot reach a paid model. Open its dashboard to connect the providers you want behind it.</span></div><button className="secondary" disabled={disabled} onClick={()=>void desktop.openDashboard('omniroute').catch(e=>setStatus(e.message))}>Open OmniRoute dashboard <ExternalLink size={13}/></button></div>}
    {config.proxyPreset==='horde'?<div className="info-box"><Cloud size={17}/><span>AI Horde uses volunteer compute and its documented anonymous access. No account or billing. Queues and model quality vary. Your prompt and requested files go to the community service. <a href={preset.docs} target="_blank" rel="noreferrer">Provider details ↗</a></span></div>:<>
     <div className="router-detail-heading"><strong>{preset.name} connection</strong><a href={preset.docs} target="_blank" rel="noreferrer">Setup guide <ArrowUpRight size={12}/></a></div>
     <label>OpenAI-compatible API base URL<input disabled={disabled} readOnly={['opencode','aistudio','aihubmix'].includes(config.proxyPreset)||!!desktop&&config.managed} value={config.proxyUrl} onChange={e=>{update({proxyUrl:e.target.value,managed:false,freeModels:[],routerFreeOnly:false,model:''});setModels([])}} placeholder="https://your-free-router.example/v1" autoComplete="off" spellCheck={false}/></label>
      {config.proxyPreset!=='freeride'&&<label>{config.proxyPreset==='opencode'?'OpenCode Zen API key':config.proxyPreset==='aistudio'?'Google AI Studio API key':config.proxyPreset==='aihubmix'?'AIHubMix API key':config.proxyPreset==='nim'?'NVIDIA NIM API key':'Router API key'} <span className="optional-field">{['opencode','nim','aistudio','aihubmix'].includes(config.proxyPreset)?'required for generation':'if your router requires one'}</span><input ref={keyInput} disabled={disabled} type="password" readOnly={!!desktop&&config.managed} value={apiKey} onChange={e=>{setKey(e.target.value.trim());setOk(false)}} placeholder={config.proxyPreset==='aistudio'?'AIzaSy…':config.proxyPreset==='nim'?'nvapi-…':config.proxyPreset==='aihubmix'?'sk-…':'Your own key · never shared across endpoints'} autoComplete="off" spellCheck={false}/></label>}
      {config.proxyPreset==='aistudio'&&<div className="info-box"><ShieldCheck size={18}/><span>Google AI Studio connects directly to Gemini 3.8 Flash and Gemma models via Google’s OpenAI-compatible API. Includes a free tier with per-minute and daily rate limits. <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Get a Google AI Studio key ↗</a></span></div>}
      {config.proxyPreset==='aihubmix'&&<div className="info-box"><ShieldCheck size={18}/><span>AIHubMix provides unified multi-provider routing (Claude, GPT, Gemini, DeepSeek, Qwen) via fast OpenAI-compatible endpoints. Trial balance is provided on registration. <a href="https://aihubmix.com" target="_blank" rel="noreferrer">Get an AIHubMix key ↗</a></span></div>}
      {config.proxyPreset==='nim'&&<div className="info-box"><ShieldCheck size={18}/><span>NVIDIA NIM uses OpenAI-compatible chat APIs. Its personal tier uses account credits and provider limits; choose from the live NIM catalogue, or use FreeRide for automatic failover across providers. <a href="https://build.nvidia.com/models" target="_blank" rel="noreferrer">Browse NIM models ↗</a></span></div>}
         {config.proxyPreset==='freeride'&&desktop&&<div className="info-box freeride-setup"><ShieldCheck size={18}/><span><strong>One-click FreeRide setup</strong><br/>MicoCode installs FreeRide privately, starts the local failover gateway, and configures automatic free-tier failover. Provider keys are stored in Windows encrypted credentials. Telemetry is disabled for MicoCode-managed installs; existing FreeRide settings are respected. A saved NVIDIA NIM key is reused automatically; otherwise enter it once.<label>NVIDIA NIM API key <span className="optional-field">required only if no saved NIM key, other provider key, or local Ollama is available</span><input disabled={disabled} type="password" value={freeRideKeys.nvidiaApiKey} onChange={e=>setFreeRideKeys(v=>({...v,nvidiaApiKey:e.target.value.trim()}))} placeholder="nvapi-…" autoComplete="off" spellCheck={false}/></label><details className="router-advanced"><summary>Add keys for more provider failover</summary><label>OpenRouter API key<input disabled={disabled} type="password" value={freeRideKeys.openRouterApiKey} onChange={e=>setFreeRideKeys(v=>({...v,openRouterApiKey:e.target.value.trim()}))} autoComplete="off" spellCheck={false}/></label><label>Groq API key<input disabled={disabled} type="password" value={freeRideKeys.groqApiKey} onChange={e=>setFreeRideKeys(v=>({...v,groqApiKey:e.target.value.trim()}))} autoComplete="off" spellCheck={false}/></label><label>Hugging Face token<input disabled={disabled} type="password" value={freeRideKeys.huggingFaceToken} onChange={e=>setFreeRideKeys(v=>({...v,huggingFaceToken:e.target.value.trim()}))} autoComplete="off" spellCheck={false}/></label><label>Cerebras API key<input disabled={disabled} type="password" value={freeRideKeys.cerebrasApiKey} onChange={e=>setFreeRideKeys(v=>({...v,cerebrasApiKey:e.target.value.trim()}))} autoComplete="off" spellCheck={false}/></label><label>Cloudflare API token<input disabled={disabled} type="password" value={freeRideKeys.cloudflareApiToken} onChange={e=>setFreeRideKeys(v=>({...v,cloudflareApiToken:e.target.value.trim()}))} autoComplete="off" spellCheck={false}/></label><label>Cloudflare account ID<input disabled={disabled} value={freeRideKeys.cloudflareAccountId} onChange={e=>setFreeRideKeys(v=>({...v,cloudflareAccountId:e.target.value.trim()}))} autoComplete="off" spellCheck={false}/></label></details></span></div>}
      {config.proxyPreset==='opencode'?<div className="info-box"><ShieldCheck size={18}/><span>The live Zen catalogue is matched with OpenCode’s published zero-price model metadata (such as Muse Spark 1.3 Contributor, Qwen 3.6 Plus, GLM-5, DeepSeek V4 Flash, Kimi K2.5, Nemotron 3 Ultra, Poolside Laguna S 2.1, MiniMax-M3, MiMo V2 Pro, Step 5 Preview, and Fledge Alpha). Your own key is required to generate. Free cloud models have provider limits and <a href="https://opencode.ai/docs/zen/#privacy" target="_blank" rel="noreferrer">provider data policies</a>; some use prompts for training. <a href="https://opencode.ai/auth" target="_blank" rel="noreferrer">Get a Zen key ↗</a></span></div>:desktop&&config.managed?<div className="info-box managed-route"><ShieldCheck size={18}/><span><strong>{config.proxyPreset==='9router'?'MicoCode private 9Router':'Managed MicoCode routes'}</strong><br/>{config.proxyPreset==='9router'?'Only routes configured in this private instance are shown. Use “Use existing 9Router” to load your own providers.':'These routes use the private engine selected above.'}<br/><ModelPicker models={models} value={config.model} allowCustom={false} disabled={disabled} refreshing={refreshingModels} onRefresh={()=>void refreshProxyModels()} onChange={selectRouterModel}/><button className="secondary" disabled={disabled} onClick={()=>update({managed:false})}>Configure this router manually</button></span></div>:<details className="router-advanced" open={!models.length}><summary>Model access and billing</summary><p>MicoCode preserves every model ID exposed by this router (including Muse Spark 1.3 Contributor, GLM-5.3, Gemma 4 31B, Qwen 3.8 / 3.6 Plus, DeepSeek V4.1 Flash, and Kimi K3). Additional live OpenCode Free discoveries are labelled separately. Access, pricing, provider limits, and fallbacks are controlled by your router and connected providers. Pricing badges show router-reported or verified provider metadata.</p></details>}
      <p className="field-help">{config.proxyPreset==='opencode'?'Your key stays in this tab’s session. Generation goes through the MicoCode relay to the official Zen API over HTTPS.':desktop&&config.managed?'MicoCode connects through its local relay. Each selected model runs on the provider configured in this router.':<>Requests go directly from your browser to this URL. Allow <code>{location.origin}</code> in the router’s CORS settings. Local routers may require local-network permission.</>}</p>
    </>}
       {!(desktop&&config.managed)&&<><ModelPicker models={visibleModels} value={config.model} allowCustom={config.proxyPreset!=='opencode'} disabled={disabled} refreshing={refreshingModels} onRefresh={()=>void refreshProxyModels()} onChange={selectRouterModel}/>{config.model.trim()&&models.length>0&&selectedPaid&&<p className="field-help">That route reports paid pricing. Your router controls billing; usage and provider limits apply.</p>}</>}
       {config.proxyPreset==='9router'&&models.some(m=>m.catalogueSource==='opencode-live')&&<div className="info-box"><Cloud size={17}/><span><strong>OpenCode Free (live catalogue)</strong><br/>These additional routes come from the current verified free provider catalogue. They use this 9Router for prompts. Access through your router and key is unchecked until you send a prompt; public discovery does not verify remote dashboard settings or key permissions.</span></div>}
       {config.proxyPreset==='9router'&&<details className="router-advanced model-help"><summary>Missing an OpenCode or other provider model?</summary><p>Use the API key for your own 9Router instance. MicoCode preserves every model ID returned by that router and labels additional live OpenCode Free discoveries separately. To check your router’s model access, refresh and enable models in its provider dashboard, then refresh this catalogue. Public model discovery does not automatically change your remote dashboard or verify its access settings.</p></details>}
   </>:config.provider==='browser'?<>
    <div className="section-label">FREE, RIGHT HERE</div><h3>A 2026 coding model that stays with you.</h3><p>Download once, then generate on your GPU without a service quota. Runs Qwen 3.5 9B or Qwen 3 8B with WebGPU. Speed and quality depend on your hardware.</p>
    <label>Model<Dropdown label="On-device model" disabled={disabled} value={config.browserSize} onChange={value=>update({browserSize:value as Config['browserSize']})} options={[{value:'9B',label:'Qwen 3.5 9B',description:'Frontier multimodal & code on-device'},{value:'8B',label:'Qwen 3 8B',description:'Fast reasoning & code on-device'}]}/></label>
    <div className="info-box"><Download size={17}/><span>First use downloads ~5.7–6.4 GB to your browser cache. Recommended: dedicated GPU with 8+ GB VRAM. Runs completely private on this device.</span></div>
   </>:config.provider==='openrouter'?<>
    <div className="section-label">VERIFIED ZERO-PRICE ROUTING</div><h3>Free cloud, with a little less friction.</h3><p>Paste your key and connect. Automatic routing discovers free models (such as Gemma 4 31B &amp; 26B, Nemotron 3 Ultra 550B, Nemotron 3.5 Lightning, and Poolside Laguna S 2.1); every request enforces a zero-price cap. Daily quotas still apply.</p>
    <label>OpenRouter API key<input ref={keyInput} disabled={disabled} type="password" value={apiKey} onChange={e=>{setKey(e.target.value.trim());setOk(false)}} placeholder="sk-or-…" autoComplete="off" spellCheck={false}/></label>
    <div className="field-help">Kept only in this tab’s session. Sent to the MicoCode relay and OpenRouter over HTTPS. <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">Get a free key <ArrowUpRight size={12}/></a></div>
    <label>Free model<Dropdown label="Free model" disabled={disabled} value={config.model} onChange={value=>update({model:value})} groups={groupOptionsByPrefix([{value:'openrouter/free',label:'Auto · OpenRouter free router'},...models.filter(m=>m.id!=='openrouter/free').map(m=>({value:m.id,label:m.name}))])}/></label>
   </>:<>
    <div className="section-label">LOCAL MODELS, MORE ROOM</div><h3>Your machine is the engine.</h3><p>{desktop?'MicoCode finds your installed Ollama, or downloads a private copy. It uses an installed model or downloads Qwen 3.5 9B automatically. No account or service quota.':'Connect 2026 coding models running in Ollama (such as Gemma 4 12B / 26B / 31B, Qwen 3.8 27B, Qwen 3.6 27B Coding, Qwen 3.5 9B / 27B / 35B, Qwen 3 Coder 30B, or Devstral 24B). The Windows setup script installs Ollama if needed and downloads Qwen 3.5 9B.'}</p>
    <div className="two-fields"><label>Local address<input disabled={disabled} value={config.ollamaUrl} onChange={e=>update({ollamaUrl:e.target.value})}/></label><label>Model<input disabled={disabled} list="ollama-models" value={config.model} onChange={e=>update({model:e.target.value})}/><datalist id="ollama-models">{localModels.map(m=><option key={m}>{m}</option>)}</datalist></label></div>
    {desktop?<><button className="primary" disabled={disabled} onClick={()=>void setupNative('ollama')}><PackageCheck size={15}/> Set up & connect Ollama</button><p className="field-help">First setup may download a large runtime and about 6.4 GB for the model. MicoCode keeps its installation in your user profile and needs no administrator access.</p></>:<><button className="secondary" disabled={disabled} onClick={downloadSetup}><Download size={14}/> Download Windows setup</button><div className="field-help">Or <a href="/micocode-proxy.mjs" download>download the relay</a>, run <code>node micocode-proxy.mjs</code>, and connect to <code>http://127.0.0.1:11435</code>. <a href="https://docs.ollama.com/faq" target="_blank" rel="noreferrer">Ollama setup ↗</a></div></>}
   </>}
   {progress&&<div className="setup-progress" role="status"><div className="setup-stages">{(['download','install','start','configure','verify','ready'] as const).map(stage=><span key={stage} className={progress.stage===stage?'current':''}>{stage}</span>)}</div><p>{progress.message}</p>{progress.percent!==undefined&&<progress max={100} value={progress.percent} aria-label="Provider download progress"/>}{busy&&<button className="secondary" onClick={cancel}><Square size={12}/> Cancel setup</button>}</div>}
    <div className="connection-actions"><button className="primary" onClick={()=>void connect()} disabled={disabled}>{busy?<LoaderCircle size={16} className="spin"/>:ok?<Check size={16}/>:config.provider==='browser'?<Download size={16}/>:<Zap size={16}/>} {busy?'Connecting…':config.provider==='browser'?(browserReady(config.browserSize)?'Check model':'Download & load model'):config.provider==='proxy'&&config.proxyPreset==='opencode'?'Save & connect':config.provider==='proxy'&&config.proxyPreset==='freeride'&&desktop?'Set up & connect FreeRide':'Connect & verify'}</button>{busy&&config.provider!=='browser'&&!progress&&<button className="secondary" onClick={cancel}>Cancel</button>}<span className="muted">{cloud?'Provider limits apply':'No service usage quota'}</span></div>
   {status&&<div role="status" className={'connection-status '+(ok?'success':'')}>{status}</div>}
   {catalogueWarning&&<div role="status" className="connection-status">{catalogueWarning}</div>}
   {locked&&<p className="field-help">Stop the current agent run to change connections.</p>}
   {restoring&&<p className="field-help" role="status">Restoring your managed connection. Setup will be available when it is ready.</p>}
   <details className="momentum-settings"><summary><SlidersHorizontal size={14}/> Momentum & code quality <span>Customize</span></summary>
    <label className="setting-switch"><input type="checkbox" disabled={disabled} checked={config.resilience} onChange={e=>update({resilience:e.target.checked})}/><span><strong>Smart limit handling</strong><small>Request pacing, reset-aware cooldowns, and up to two transient retries. Daily quota and billing errors stop immediately.</small></span></label>
    <label className="setting-switch"><input type="checkbox" disabled={disabled} checked={config.freeFallback} onChange={e=>update({freeFallback:e.target.checked})}/><span><strong>Free model &amp; provider fallback</strong><small>Instant automatic cascade across configured providers (OpenCode → AIHubMix → Google AI Studio → NVIDIA NIM → OpenRouter → Ollama) on rate limits (429), quota exhaustion (402), or server errors.</small></span></label>
    <label className="setting-switch"><input type="checkbox" disabled={disabled} checked={config.compactContext} onChange={e=>update({compactContext:e.target.checked})}/><span><strong>Lean context</strong><small>Trim older tool results, read file ranges, and make exact edits instead of rewriting whole files.</small></span></label>
    <label className="setting-switch"><input type="checkbox" disabled={disabled} checked={config.quality==='polished'} onChange={e=>update({quality:e.target.checked?'polished':'focused'})}/><span><strong>Polished code</strong><small>Design-aware instructions and a final static review for accessibility, mobile metadata, and broken resources.</small></span></label>
   </details>
  </div>
  <div className="connection-footer"><ShieldCheck size={14}/> Projects stay on this device. Cloud requests share your prompt and requested files with the connection you choose.</div>
 </Modal>;
}
