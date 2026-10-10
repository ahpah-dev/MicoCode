export const proxyPresets = [
 {id:'9router',name:'9Router',initial:'9',url:'http://127.0.0.1:20128/v1',description:'All connected providers, models, and combos.',docs:'https://github.com/decolua/9router'},
 {id:'litellm',name:'LiteLLM',initial:'L',url:'http://127.0.0.1:4000/v1',description:'Connect a gateway you control.',docs:'https://docs.litellm.ai/docs/simple_proxy'},
 {id:'cliproxy',name:'CLIProxyAPI',initial:'C',url:'http://127.0.0.1:8317/v1',description:'Use your authorized free routes.',docs:'https://github.com/router-for-me/CLIProxyAPI'},
 {id:'horde',name:'AI Horde',initial:'H',url:'https://oai.aihorde.net/v1',description:'Community compute. No key needed.',docs:'https://oai.aihorde.net/'},
 {id:'custom',name:'Custom router',initial:'+',url:'',description:'Any OpenAI-compatible free router.',docs:'https://platform.openai.com/docs/api-reference/chat'},
];

export function normalizeEndpoint(value) {
 let url; try {url=new URL(value.trim())} catch {throw new Error('Enter a valid API base URL, ending in /v1.')}
 const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(url.username||url.password||url.search||url.hash)throw new Error('Keep credentials in the key field, not in the endpoint URL.');
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))throw new Error('Use HTTPS for remote routers, or HTTP on localhost.');
 return url.href.replace(/\/+$/,'');
}

// Scope keys to an exact endpoint; a saved key must never follow a provider switch.
export function credentialSlot(config) {
 if(config.provider==='openrouter')return 'mico-key:openrouter';
 if(config.provider==='proxy'&&config.proxyPreset!=='horde') {
  try{return 'mico-key:proxy:'+normalizeEndpoint(config.proxyUrl)}catch{return ''}
 }
 return '';
}
export function readCredential(config,storage) {
 const slot=credentialSlot(config); if(!slot)return '';
 try{return (storage||globalThis.sessionStorage).getItem(slot)||''}catch{return ''}
}
export function writeCredential(config,key,storage=globalThis.sessionStorage) {
 const slot=credentialSlot(config);if(!slot)return;
 if(key)storage.setItem(slot,key);else storage.removeItem(slot);
}
export function connectionIdentity(config) {
 return [config.provider,config.provider==='proxy'?config.proxyPreset:'',config.provider==='proxy'?config.proxyUrl:config.provider==='ollama'?config.ollamaUrl:'',config.provider==='browser'?config.browserSize:config.model].join('|');
}
export function profileSlot(config) {return config.provider==='proxy'?'proxy:'+config.proxyPreset:config.provider}
export function shouldRestoreManagedConnection(savedConfig) {return !savedConfig||savedConfig.managed===true}
const managedPresets=['9router','cliproxy','litellm'];
// Router-safe route id for a provider model name; unique within the handled set.
export function routeSlug(name,taken=new Set()) {
 let base=String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'model';
 let slug=base,n=2;while(taken.has(slug))slug=base+'-'+(n++);taken.add(slug);return slug;
}
// Only apply this to a result returned by the trusted native setup/restore bridge.
// A local URL or a model name alone never makes a manually configured route free.
export function applyManagedConnection(current,result) {
 const c=result?.config;
 if(!c||typeof result.key!=='string'||!result.key)throw new Error('Managed setup returned an incomplete connection. Run Set up & connect again.');
 const endpoint=normalizeEndpoint(c.provider==='ollama'?c.ollamaUrl:c.proxyUrl);
 if(!['localhost','127.0.0.1','[::1]'].includes(new URL(endpoint).hostname))throw new Error('Managed setup must return a local connection.');
 if(c.provider==='ollama'&&typeof c.model==='string'&&c.model.trim())return {...current,...c,managed:true};
 if(c.provider!=='proxy'||!managedPresets.includes(c.proxyPreset))throw new Error('Managed setup returned an unsupported router. Run Set up & connect again.');
 const routes=Array.isArray(c.freeModels)?c.freeModels.filter(m=>typeof m==='string'&&m):[];
 if(!routes.length||typeof c.model!=='string'||!routes.includes(c.model))throw new Error('Managed setup did not return its configured free routes. Run Set up & connect again.');
 // Keep a still-offered selection across re-setup and restore; otherwise take the new default.
 const model=typeof current?.model==='string'&&routes.includes(current.model)?current.model:c.model;
 return {...current,...c,model,managed:true,freeModels:routes,routerFreeOnly:true};
}
export function recallProfile(next,storage=globalThis.localStorage) {
 try{const profiles=JSON.parse(storage.getItem('mico-profiles:v1')||storage.getItem('mico-profiles')||'{}');const saved=profiles[profileSlot(next)];return saved?{...next,model:saved.model,proxyUrl:saved.proxyUrl??next.proxyUrl,freeModels:Array.isArray(saved.freeModels)?saved.freeModels:[],routerFreeOnly:saved.routerFreeOnly===true,ollamaUrl:saved.ollamaUrl??next.ollamaUrl,managed:saved.managed===true,routerEngine:saved.routerEngine==='community'?'community':'local'}:next}catch{return next}
}
export function rememberProfile(config,storage=globalThis.localStorage) {
 let profiles={};try{profiles=JSON.parse(storage.getItem('mico-profiles:v1')||storage.getItem('mico-profiles')||'{}')}catch{}
 profiles[profileSlot(config)]={model:config.model,proxyUrl:config.proxyUrl,freeModels:config.freeModels,routerFreeOnly:config.routerFreeOnly,ollamaUrl:config.ollamaUrl,managed:config.managed===true,routerEngine:config.routerEngine};
 storage.setItem('mico-profiles:v1',JSON.stringify(profiles));
}

export function hasZeroPrice(model) {
 const p=model.pricing;
 if(p&&p.prompt!=null&&p.completion!=null)return Number(p.prompt)===0&&Number(p.completion)===0;
 return model.cost?.input!=null&&model.cost?.output!=null&&Number(model.cost.input)===0&&Number(model.cost.output)===0;
}
export function freeCatalogue(data,allowlist=[],declared=false) {
 const models=Array.isArray(data?.data)?data.data:Array.isArray(data?.models)?data.models:[];
 return models.filter(m=>m&&typeof m.id==='string'&&m.id.length<200&&![m.pricing?.prompt,m.pricing?.completion,m.cost?.input,m.cost?.output].some(p=>p!=null&&Number(p)>0)&&(hasZeroPrice(m)||(declared&&allowlist.includes(m.id)))).map(m=>({id:m.id,name:typeof m.name==='string'?m.name:m.id,verified:hasZeroPrice(m),paid:false,provider:providerOf(m)}));
}
// Provider grouping for router catalogues (9Router exposes `prefix/model`
// ids with `owned_by`). Falls back to the id prefix, then an Other bucket.
export function providerOf(entry) {
 if(entry&&typeof entry.owned_by==='string'&&entry.owned_by)return entry.owned_by;
 const id=typeof entry?.id==='string'?entry.id:(typeof entry==='string'?entry:'');
 const slash=id.indexOf('/');return slash>0?id.slice(0,slash):'';
}
function hasPaidPrice(model) {
 return [model?.pricing?.prompt,model?.pricing?.completion,model?.cost?.input,model?.cost?.output].some(p=>p!=null&&Number(p)>0);
}
function modelLimits(model) {
 const context=Number(model?.context_length??model?.context);
 const output=Number(model?.max_completion_tokens??model?.max_output_tokens);
 return {...(Number.isFinite(context)&&context>0?{contextLength:context}:{}),...(Number.isFinite(output)&&output>0?{maxOutput:output}:{})};
}
export function fullCatalogue(data) {
 const models=Array.isArray(data?.data)?data.data:Array.isArray(data?.models)?data.models:[];
 return models.filter(m=>m&&typeof m.id==='string'&&m.id.length>0&&m.id.length<200).map(m=>({id:m.id,name:typeof m.name==='string'?m.name:m.id,verified:hasZeroPrice(m),paid:hasPaidPrice(m),provider:providerOf(m),...modelLimits(m)}));
}
// Grouped, sorted provider sections for the model picker.
export function groupRouterModels(models) {
 const groups=new Map();
 for(const m of models||[]) {
  const key=(m&&typeof m.provider==='string'&&m.provider)||'Other';
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(m);
 }
 return [...groups.entries()]
  .map(([provider,items])=>({provider,items:[...items].sort((a,b)=>String(a.name||a.id).localeCompare(String(b.name||b.id)))}))
  .sort((a,b)=>a.provider==='Other'?1:b.provider==='Other'?-1:String(a.provider).localeCompare(String(b.provider)));
}
export function matchModel(model,query) {
 const q=String(query||'').trim().toLowerCase();if(!q)return true;
 return [model?.id,model?.name,model?.provider].some(v=>typeof v==='string'&&v.toLowerCase().includes(q));
}
export function bestCodingModel(models) {
 const text=m=>(String(m.id||'')+' '+String(m.name||'')).toLowerCase();
 const score=m=>/claude-(opus|sonnet)|gpt-5|gemini-3.*pro|glm-5|deepseek-v3|qwen3.*coder|kimi-k2\.5|grok-4|codestral|devstral/.test(text(m))?10:/coder|coding/.test(text(m))?8:/qwen/.test(text(m))?6:/gemma|instruct|llama/.test(text(m))?3:0;
 const context=m=>Number(m.contextLength)||0;
 return [...models].sort((a,b)=>score(b)-score(a)||context(b)-context(a)||a.id.localeCompare(b.id))[0]?.id||'';
}
// Full router catalogue: every exposed model, flagged when the router reports zero pricing.
// Unlike discoverProxy, this never hides models; selection stays the user's choice.
export async function listProxyModels(config,key,signal) {
 if(config.proxyPreset==='horde') {
  const r=await fetch('/api/horde',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'models'}),signal});
  const d=await r.json();if(!r.ok)throw new Error(d.error||'AI Horde is unavailable.');return d.models;
 }
 const base=normalizeEndpoint(config.proxyUrl);
 let r;
 try{r=await fetch(base+'/models',{redirect:'error',headers:key?{Authorization:'Bearer '+key}:{},signal})}catch(e){if(signal?.aborted)throw e;throw new Error('Could not reach the router. Start it, use its final API URL without redirects, allow this site in CORS, and allow local-network access when your browser asks.')}
 const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error?.message||d.error||'Router returned '+r.status+'. Check its key and address.');
 const models=fullCatalogue(d);
 if(!models.length)throw new Error(config.proxyPreset==='9router'?'9Router returned an empty model list. Check that the API key belongs to this router, is unrestricted (or allows these models), and that providers and models are enabled in its dashboard.':'The router returned no models. Check its address and key, then try again. You can still type a model ID below.');
 return models;
}
export async function discoverProxy(config,key,signal) {
 if(config.proxyPreset==='horde') {
  const r=await fetch('/api/horde',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'models'}),signal});
  const d=await r.json();if(!r.ok)throw new Error(d.error||'AI Horde is unavailable.');return d.models;
 }
 const base=normalizeEndpoint(config.proxyUrl);
 let r;
 try{r=await fetch(base+'/models',{redirect:'error',headers:key?{Authorization:'Bearer '+key}:{},signal})}catch(e){if(signal?.aborted)throw e;throw new Error('Could not reach the router. Start it, use its final API URL without redirects, allow this site in CORS, and allow local-network access when your browser asks.')}
 const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error?.message||d.error||'Router returned '+r.status+'. Check its key and address.');
 const models=freeCatalogue(d,config.freeModels,config.routerFreeOnly);
 if(!models.length)throw new Error('No free routes verified. If your router omits pricing, add exact free model IDs below and confirm free-only routing. Paid or unknown models stay hidden.');
 return models;
}
