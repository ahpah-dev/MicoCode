export const proxyPresets = [
 {id:'9router',name:'9Router',initial:'9',url:'http://127.0.0.1:20128/v1',description:'Your free routes, one endpoint.',docs:'https://github.com/decolua/9router'},
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
export function recallProfile(next,storage=globalThis.localStorage) {
 try{const profiles=JSON.parse(storage.getItem('mico-profiles:v1')||storage.getItem('mico-profiles')||'{}');const saved=profiles[profileSlot(next)];return saved?{...next,model:saved.model,proxyUrl:saved.proxyUrl??next.proxyUrl,freeModels:saved.freeModels||[],routerFreeOnly:saved.routerFreeOnly||false,ollamaUrl:saved.ollamaUrl??next.ollamaUrl}:next}catch{return next}
}
export function rememberProfile(config,storage=globalThis.localStorage) {
 let profiles={};try{profiles=JSON.parse(storage.getItem('mico-profiles:v1')||storage.getItem('mico-profiles')||'{}')}catch{}
 profiles[profileSlot(config)]={model:config.model,proxyUrl:config.proxyUrl,freeModels:config.freeModels,routerFreeOnly:config.routerFreeOnly,ollamaUrl:config.ollamaUrl};
 storage.setItem('mico-profiles:v1',JSON.stringify(profiles));
}

export function hasZeroPrice(model) {
 const p=model.pricing;
 if(p&&p.prompt!=null&&p.completion!=null)return Number(p.prompt)===0&&Number(p.completion)===0;
 return model.cost?.input!=null&&model.cost?.output!=null&&Number(model.cost.input)===0&&Number(model.cost.output)===0;
}
export function freeCatalogue(data,allowlist=[],declared=false) {
 const models=Array.isArray(data?.data)?data.data:Array.isArray(data?.models)?data.models:[];
 return models.filter(m=>m&&typeof m.id==='string'&&m.id.length<200&&![m.pricing?.prompt,m.pricing?.completion,m.cost?.input,m.cost?.output].some(p=>p!=null&&Number(p)>0)&&(hasZeroPrice(m)||(declared&&allowlist.includes(m.id)))).map(m=>({id:m.id,name:typeof m.name==='string'?m.name:m.id,verified:hasZeroPrice(m)}));
}
export function bestCodingModel(models) {
 const score=m=>/coder|coding/i.test(m.id)?8:/qwen/i.test(m.id)?6:/gemma|instruct|llama/i.test(m.id)?3:0;
 return [...models].sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id))[0]?.id||'';
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
