'use client';
import {useEffect,useRef,useState} from 'react';
import {Cpu,Cloud,Monitor,ArrowUpRight,Check,Download,LoaderCircle,ShieldCheck,Network,Zap,SlidersHorizontal} from 'lucide-react';
import {Modal} from './primitives';
import {browserReady,loadBrowserModel} from '@/lib/mico/agent';
import {bestCodingModel,credentialSlot,discoverProxy,proxyPresets,readCredential,recallProfile} from '@/lib/mico/providers.mjs';
import type {Config,ProxyPreset} from '@/lib/mico/types';

type Model={id:string;name:string;verified?:boolean};
type Props={config:Config;setConfig:(c:Config)=>void;apiKey:string;setKey:(s:string)=>void;onClose:()=>void;onReady:(s:string)=>void;locked?:boolean};
export function Connections({config,setConfig,apiKey,setKey,onClose,onReady,locked=false}:Props){
 const [status,setStatus]=useState('');
 const [busy,setBusy]=useState(false);
 const [ok,setOk]=useState(false);
 const [models,setModels]=useState<Model[]>([]);
 const [localModels,setLocalModels]=useState<string[]>([]);
 const controller=useRef<AbortController|null>(null);
 const keyInput=useRef<HTMLInputElement>(null);
 const disabled=busy||locked;
 const preset=proxyPresets.find(p=>p.id===config.proxyPreset)!;
 const cloud=config.provider==='openrouter'||config.provider==='proxy';
 const update=(patch:Partial<Config>)=>{setConfig({...config,...patch});setStatus('');setOk(false)};
 useEffect(()=>()=>controller.current?.abort(),[]);
 useEffect(()=>{
  if(config.provider!=='openrouter')return;
  const abort=new AbortController();
  fetch('/api/models',{signal:abort.signal}).then(r=>r.json()).then(d=>{if(d.models)setModels(d.models);else setStatus(d.error)}).catch(()=>{if(!abort.signal.aborted)setStatus('Model discovery is unavailable. The free router remains selectable.')});
  return()=>abort.abort();
 },[config.provider]);
 function chooseProvider(provider:Config['provider']){
  const next=recallProfile({...config,provider,model:provider==='openrouter'?'openrouter/free':provider==='ollama'?'qwen2.5-coder:3b':provider==='proxy'?'':config.model});
  setConfig(next);setModels([]);setStatus('');setOk(false);
 }
 function chooseProxy(id:string){
  const p=proxyPresets.find(p=>p.id===id)!;
  const next=recallProfile({...config,provider:'proxy',proxyPreset:id as ProxyPreset,proxyUrl:p.url,model:'',freeModels:[],routerFreeOnly:false});
  setConfig(next);setModels([]);setStatus('');setOk(false);return next;
 }
 async function connect(candidate:Config=config){
  if(disabled)return;
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
    const key=credentialSlot(candidate)===credentialSlot(config)?apiKey:readCredential(candidate);
    if(!key)throw new Error('Paste your own OpenRouter key, then connect.');
    const r=await fetch('/api/connection',{method:'POST',headers:{Authorization:'Bearer '+key},signal:abort.signal});
    const d=await r.json();if(!r.ok)throw new Error(d.error);
    setStatus(d.quota?'Connected. '+d.quota.remaining+' of '+d.quota.limit+' free requests remain today.':'Connected. Only zero-price routes are enabled; provider quotas apply.');
   }else{
    const key=credentialSlot(candidate)===credentialSlot(config)?apiKey:readCredential(candidate);
    const available:Model[]=await discoverProxy(candidate,key,abort.signal);
    if(!available.length)throw new Error('No active free models found. Retry later or choose another connection.');
    setModels(available);
    const model=available.some(m=>m.id===candidate.model)?candidate.model:bestCodingModel(available);
    setConfig({...candidate,model});
    setStatus(candidate.proxyPreset==='horde'?'Connected to the catalogue. Volunteer queues can be slow; generation is experimental and was unavailable in our latest test.': 'Connected. '+available.length+' free routes found. '+(available.every(m=>m.verified)?'Zero pricing reported by the router.':'Using your declared free-only routes; downstream billing is controlled by your router.'));
   }
   if(abort.signal.aborted)return;setOk(true);onReady(candidate.provider);
  }catch(e){if(!abort.signal.aborted)setStatus((e as Error).message);else setStatus('Connection stopped or timed out. Check your router, then try again.')}
  finally{clearTimeout(timer);setBusy(false);controller.current=null}
 }
 function quickConnect(id:string){
  const next=chooseProxy(id);
  // Anonymous Horde is the only preset that supplies an intentionally public key.
  // Other routers use the key saved for their exact URL, or their configured no-key mode.
  void connect(next);
 }
 function downloadSetup(){const origin=location.origin.replace(/'/g,"''");const script=`# MicoCode local AI setup for Windows\n# Installs Ollama if missing, permits only your MicoCode origin, and downloads a coding model.\n$ErrorActionPreference = 'Stop'\nif (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {\n  winget install --id Ollama.Ollama --exact --accept-package-agreements --accept-source-agreements\n  if ($LASTEXITCODE -ne 0) { throw 'Ollama installation failed. Install from https://ollama.com/download and run this script again.' }\n  $env:Path += ';' + (Join-Path $env:LOCALAPPDATA 'Programs\\Ollama')\n}\n$micoOrigin = '${origin}'\n$priorOrigins = [Environment]::GetEnvironmentVariable('OLLAMA_ORIGINS','User')\n$micoOrigins = (@($priorOrigins -split ',' | Where-Object { $_ }) + @($micoOrigin) | Select-Object -Unique) -join ','\n[Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', $micoOrigins, 'User')\n$env:OLLAMA_ORIGINS = $micoOrigins\nif (Get-Process -Name ollama -ErrorAction SilentlyContinue) {\n  Write-Host 'Quit Ollama from the system tray, reopen it to load the allowed origin, then press Enter.'\n  Read-Host | Out-Null\n} else {\n  Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden\n  Start-Sleep -Seconds 4\n}\nollama pull qwen2.5-coder:3b\nif ($LASTEXITCODE -ne 0) { throw 'Model download failed. Check Ollama is running, then retry.' }\nWrite-Host 'Ready. Return to MicoCode, choose Ollama, and click Connect.'\n`;
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([script],{type:'text/plain'}));a.download='micocode-setup.ps1';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}

 return <Modal title="Find your flow." subtitle="Free models. Familiar routers. One place to connect." onClose={onClose} wide>
  <div className="connection-summary"><span><ShieldCheck size={14}/> Free routes only</span><span><Zap size={14}/> Smart pacing</span><span><SlidersHorizontal size={14}/> Polished code</span></div>
  <div className="provider-grid">
   {([{id:'browser',name:'On device',sub:'No key · no service quota',Icon:Cpu},{id:'ollama',name:'Ollama',sub:'Your installed models',Icon:Monitor},{id:'openrouter',name:'OpenRouter',sub:'Verified zero-price cloud',Icon:Cloud},{id:'proxy',name:'Free proxies',sub:'9Router & compatible APIs',Icon:Network}] as const).map(p=><button disabled={disabled} aria-pressed={config.provider===p.id} className={'provider-card '+(config.provider===p.id?'active':'')} key={p.id} onClick={()=>chooseProvider(p.id)}><p.Icon size={21}/><strong>{p.name}</strong><small>{p.sub}</small>{config.provider===p.id&&<Check className="provider-check" size={15}/>}</button>)}
  </div>
  <div className="connection-body">
   {config.provider==='proxy'?<>
    <div className="section-label">BRING YOUR FAVORITE FREE ROUTER</div><h3>A good connection goes a long way.</h3>
    <p>Pick a router, connect once, and keep creating. Local routers must already be running. MicoCode remembers their address and keeps each key separate for this tab.</p>
    <div className="router-grid">{proxyPresets.map(p=><article className={'router-card '+(config.proxyPreset===p.id?'active':'')} key={p.id}><button className="router-select" disabled={disabled} aria-pressed={config.proxyPreset===p.id} onClick={()=>chooseProxy(p.id)}><span className="router-monogram">{p.initial}</span><span><strong>{p.name}</strong><small>{p.description}</small></span>{config.proxyPreset===p.id&&<Check size={13}/>}</button><div className="router-card-footer"><span>{p.id==='horde'?'EXPERIMENTAL · NO KEY':p.id==='custom'?'YOUR FREE ROUTES':'SELF-HOSTED'}</span><button disabled={disabled} onClick={()=>quickConnect(p.id)} aria-label={'Connect '+p.name}>Connect <ArrowUpRight size={12}/></button></div></article>)}</div>
    {config.proxyPreset==='horde'?<div className="info-box"><Cloud size={17}/><span>AI Horde uses volunteer compute and its documented anonymous access. No account or billing. Queues and model quality vary. Your prompt and requested files go to the community service. <a href={preset.docs} target="_blank" rel="noreferrer">Provider details ↗</a></span></div>:<>
     <div className="router-detail-heading"><strong>{preset.name} connection</strong><a href={preset.docs} target="_blank" rel="noreferrer">Setup guide <ArrowUpRight size={12}/></a></div>
     <label>OpenAI-compatible API base URL<input disabled={disabled} value={config.proxyUrl} onChange={e=>{update({proxyUrl:e.target.value,freeModels:[],routerFreeOnly:false,model:''});setModels([])}} placeholder="https://your-free-router.example/v1" autoComplete="off" spellCheck={false}/></label>
     <label>Router API key <span className="optional-field">if your router requires one</span><input ref={keyInput} disabled={disabled} type="password" value={apiKey} onChange={e=>{setKey(e.target.value.trim());setOk(false)}} placeholder="Your own key · never shared across endpoints" autoComplete="off" spellCheck={false}/></label>
     <details className="router-advanced" open={!models.length}><summary>Free route setup</summary><p>Routers can also offer paid models. We only show zero-price metadata or the exact free routes you declare here. Disable paid fallbacks in your router first.</p><label>Free model IDs<input disabled={disabled} value={config.freeModels.join(', ')} onChange={e=>update({freeModels:e.target.value.split(',').map(s=>s.trim()).slice(0,50),model:''})} placeholder="Exact model IDs, separated by commas" spellCheck={false}/></label><label className="setting-switch"><input disabled={disabled} type="checkbox" checked={config.routerFreeOnly} onChange={e=>update({routerFreeOnly:e.target.checked})}/><span><strong>My router uses free routes only</strong><small>Required for IDs without pricing. MicoCode cannot inspect your router’s downstream billing.</small></span></label></details>
     <p className="field-help">Requests go directly from your browser to this URL. Allow <code>{location.origin}</code> in the router’s CORS settings. Local routers may require local-network permission.</p>
    </>}
    {models.length>0&&<label>Available free model<select disabled={disabled} value={config.model} onChange={e=>update({model:e.target.value})}>{models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
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
    <div className="section-label">LOCAL MODELS, MORE ROOM</div><h3>Your machine is the engine.</h3><p>Connect the models already running in Ollama. The Windows setup script installs Ollama if needed and downloads Qwen Coder 3B.</p>
    <div className="two-fields"><label>Local address<input disabled={disabled} value={config.ollamaUrl} onChange={e=>update({ollamaUrl:e.target.value})}/></label><label>Model<input disabled={disabled} list="ollama-models" value={config.model} onChange={e=>update({model:e.target.value})}/><datalist id="ollama-models">{localModels.map(m=><option key={m}>{m}</option>)}</datalist></label></div>
    <button className="secondary" disabled={disabled} onClick={downloadSetup}><Download size={14}/> Download Windows setup</button>
    <div className="field-help">Or <a href="/micocode-proxy.mjs" download>download the relay</a>, run <code>node micocode-proxy.mjs</code>, and connect to <code>http://127.0.0.1:11435</code>. <a href="https://docs.ollama.com/faq" target="_blank" rel="noreferrer">Ollama setup ↗</a></div>
   </>}
   <div className="connection-actions"><button className="primary" onClick={()=>void connect()} disabled={disabled}>{busy?<LoaderCircle size={16} className="spin"/>:ok?<Check size={16}/>:config.provider==='browser'?<Download size={16}/>:<Zap size={16}/>} {busy?'Connecting…':config.provider==='browser'?(browserReady(config.browserSize)?'Check model':'Download & load model'):'Connect & verify'}</button>{busy&&config.provider!=='browser'&&<button className="secondary" onClick={()=>controller.current?.abort()}>Cancel</button>}<span className="muted">{cloud?'Free routes · provider limits apply':'No service usage quota'}</span></div>
   {status&&<div role="status" className={'connection-status '+(ok?'success':'')}>{status}</div>}
   {locked&&<p className="field-help">Stop the current agent run to change connections.</p>}
   <details className="momentum-settings"><summary><SlidersHorizontal size={14}/> Momentum & code quality <span>Customize</span></summary>
    <label className="setting-switch"><input type="checkbox" disabled={disabled} checked={config.resilience} onChange={e=>update({resilience:e.target.checked})}/><span><strong>Smart limit handling</strong><small>Request pacing, reset-aware cooldowns, and up to two transient retries. Daily quota and billing errors stop immediately.</small></span></label>
    <label className="setting-switch"><input type="checkbox" disabled={disabled} checked={config.freeFallback} onChange={e=>update({freeFallback:e.target.checked})}/><span><strong>Free model fallback</strong><small>OpenRouter can switch to its free router when a selected free model is unavailable. Always zero price.</small></span></label>
    <label className="setting-switch"><input type="checkbox" disabled={disabled} checked={config.compactContext} onChange={e=>update({compactContext:e.target.checked})}/><span><strong>Lean context</strong><small>Trim older tool results, read file ranges, and make exact edits instead of rewriting whole files.</small></span></label>
    <label className="setting-switch"><input type="checkbox" disabled={disabled} checked={config.quality==='polished'} onChange={e=>update({quality:e.target.checked?'polished':'focused'})}/><span><strong>Polished code</strong><small>Design-aware instructions and a final static review for accessibility, mobile metadata, and broken resources.</small></span></label>
   </details>
  </div>
  <div className="connection-footer"><ShieldCheck size={14}/> Projects stay in this browser. Cloud requests share your prompt and requested files with the connection you choose.</div>
 </Modal>;
}
