export const proxyPresets = [
 {id:'9router',name:'9Router',initial:'9',url:'http://127.0.0.1:20128/v1',description:'All connected providers, models, and combos.',docs:'https://github.com/decolua/9router',hidden:false},
 {id:'litellm',name:'LiteLLM',initial:'L',url:'http://127.0.0.1:4000/v1',description:'Connect a gateway you control.',docs:'https://docs.litellm.ai/docs/simple_proxy',hidden:false},
 {id:'cliproxy',name:'CLIProxyAPI',initial:'C',url:'http://127.0.0.1:8317/v1',description:'Use your authorized free routes.',docs:'https://github.com/router-for-me/CLIProxyAPI',hidden:false},
 {id:'freeride',name:'FreeRide',initial:'F',url:'http://127.0.0.1:11343/v1',description:'Free-tier models with automatic provider failover.',docs:'https://clawhub.ai/shaivpidadi/freeride-gateway',hidden:false},
 {id:'aistudio',name:'Google AI Studio',initial:'G',url:'https://generativelanguage.googleapis.com/v1beta/openai',description:'Gemini 2.5 Pro, Flash & Gemma models with your AI Studio API key.',docs:'https://aistudio.google.com/apikey',hidden:false},
 {id:'nim',name:'NVIDIA NIM',initial:'N',url:'https://integrate.api.nvidia.com/v1',description:'NVIDIA hosted models. API key and account credits required.',docs:'https://build.nvidia.com/models',hidden:false},
 {id:'horde',name:'AI Horde',initial:'H',url:'https://oai.aihorde.net/v1',description:'Community compute. No key needed.',docs:'https://oai.aihorde.net/',hidden:true},
 {id:'opencode',name:'OpenCode Zen',initial:'O',url:'https://opencode.ai/zen/v1',description:'Verified free Zen models with your key.',docs:'https://opencode.ai/docs/zen/',hidden:true},
 {id:'custom',name:'Custom router',initial:'+',url:'',description:'Any OpenAI-compatible router.',docs:'https://platform.openai.com/docs/api-reference/chat',hidden:false},
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
 try{
  const val=(storage||globalThis.sessionStorage).getItem(slot);
  if(val)return val;
  return (typeof globalThis.localStorage!=='undefined'&&globalThis.localStorage.getItem(slot))||'';
 }catch{return ''}
}
export function writeCredential(config,key,storage=globalThis.sessionStorage) {
 const slot=credentialSlot(config);if(!slot)return;
 try{
  if(key){
   storage?.setItem(slot,key);
   if(typeof globalThis.localStorage!=='undefined')globalThis.localStorage.setItem(slot,key);
  }else{
   storage?.removeItem(slot);
   if(typeof globalThis.localStorage!=='undefined')globalThis.localStorage.removeItem(slot);
  }
 }catch{}
}
export function connectionIdentity(config) {
 return [config.provider,config.provider==='proxy'?config.proxyPreset:'',config.provider==='proxy'?config.proxyUrl:config.provider==='ollama'?config.ollamaUrl:'',config.provider==='browser'?config.browserSize:config.model].join('|');
}
export function profileSlot(config) {return config.provider==='proxy'?'proxy:'+config.proxyPreset:config.provider}
export function shouldRestoreManagedConnection(savedConfig) {return !savedConfig||savedConfig.managed===true}
const managedPresets=['9router','cliproxy','litellm','freeride'];
// Router-safe route id for a provider model name; unique within the handled set.
export function routeSlug(name,taken=new Set()) {
 let base=String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'model';
 let slug=base,n=2;while(taken.has(slug))slug=base+'-'+(n++);taken.add(slug);return slug;
}
// Only apply this to a result returned by the trusted native setup/restore bridge.
// A local URL or a model name alone never makes a manually configured route free.
export function applyManagedConnection(current,result) {
 const c=result?.config;
 if(!c||typeof result.key!=='string')throw new Error('Managed setup returned an incomplete connection. Run Set up & connect again.');
 const endpoint=normalizeEndpoint(c.provider==='ollama'?c.ollamaUrl:c.proxyUrl);
 if(!['localhost','127.0.0.1','[::1]'].includes(new URL(endpoint).hostname))throw new Error('Managed setup must return a local connection.');
 if(c.provider==='ollama'&&typeof c.model==='string'&&c.model.trim())return {...current,...c,managed:true};
 if(!result.key)throw new Error('Managed setup returned an incomplete connection. Run Set up & connect again.');
 if(c.provider!=='proxy'||!managedPresets.includes(c.proxyPreset))throw new Error('Managed setup returned an unsupported router. Run Set up & connect again.');
 const routes=Array.isArray(c.freeModels)?c.freeModels.filter(m=>typeof m==='string'&&m):[];
 if(!routes.length||typeof c.model!=='string'||!routes.includes(c.model))throw new Error('Managed setup did not return its configured free routes. Run Set up & connect again.');
 // Keep a still-offered selection across re-setup and restore; otherwise take the new default.
  const routerModels=c.proxyPreset==='9router'&&Array.isArray(c.routerModels)?c.routerModels.filter(m=>typeof m==='string'&&m.trim()&&m.length<200):routes;
  const model=typeof current?.model==='string'&&routerModels.includes(current.model)?current.model:c.model;
  return {...current,...c,model,managed:true,freeModels:routes,routerModels,routerFreeOnly:c.proxyPreset!=='9router'};
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
 const seen=new Set();
 return models.filter(m=>{if(!m||typeof m.id!=='string'||m.id.length===0||m.id.length>=200||seen.has(m.id))return false;seen.add(m.id);return true}).map(m=>({id:m.id,name:typeof m.name==='string'?m.name:m.id,verified:hasZeroPrice(m),paid:hasPaidPrice(m),provider:m.catalogueSource==='opencode-live'?'OpenCode Free (live catalogue)':providerOf(m),...modelLimits(m),...(m.catalogueSource==='opencode-live'?{catalogueSource:'opencode-live',accessUnchecked:true}:{})}));
}
// Public provider availability does not prove that a user's router key can
// access the route. Keep router-listed entries untouched and mark additions.
export function supplementOpenCodeModels(routerModels,freeModels) {
 const models=[...routerModels],seen=new Set(models.map(m=>m.id));
 for(const model of freeModels||[]) {
  if(model?.verified!==true||model.paid===true||typeof model.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,196}$/.test(model.id))continue;
  const id='oc/'+model.id;if(seen.has(id))continue;seen.add(id);
  models.push({id,name:typeof model.name==='string'?model.name:model.id,provider:'OpenCode Free (live catalogue)',verified:true,paid:false,catalogueSource:'opencode-live',accessUnchecked:true,...(Number(model.contextLength)>0?{contextLength:Number(model.contextLength)}:{}),...(Number(model.maxOutput)>0?{maxOutput:Number(model.maxOutput)}:{})});
 }
 return models;
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
 const score=m=>/muse-spark-1\.3|muse-spark|glm-5(\.[123])?|gemma-?4|qwen3\.[5678]|qwen3.*coder|deepseek-v4(\.1)?|kimi-k[23]|nemotron-3(\.5)?-(ultra|super|lightning)|laguna-s|minimax-m3|mimo-v2(\.[56])?|step-5|fledge-alpha|claude-(opus|sonnet)|gpt-5|gemini-2\.5-pro|gemini-[34]|grok-(4|code)|devstral|codestral/.test(text(m))?10:/coder|coding|code|gemini-2\.5-flash(?!-lite)/.test(text(m))?8:/qwen3|deepseek|nemotron|glm|kimi|minimax|mimo|muse|laguna|step|fledge|gemini/.test(text(m))?6:/gemma|instruct|llama/.test(text(m))?3:0;
 const context=m=>Number(m.contextLength)||0;
 return [...models].sort((a,b)=>score(b)-score(a)||context(b)-context(a)||a.id.localeCompare(b.id))[0]?.id||'';
}
// Model IDs are opaque: preserve provider prefixes and combo IDs exactly.
// A stale profile must not silently send an unavailable model to a different router.
export function selectCatalogueModel(models,selected='',{allowCustom=false,preferred=''}={}) {
 if(!Array.isArray(models)||!models.length)throw new Error('No models are available. Refresh the catalogue or check your provider connections.');
 const id=String(selected||'').trim();
 if(id&&(models.some(m=>m.id===id)||allowCustom))return id;
 if(id)throw new Error('The selected model “'+id+'” is not in this router’s current catalogue. Choose a listed model, or enter an exact custom model ID to try it.');
 if(preferred&&models.some(m=>m.id===preferred))return preferred;
 const listed=models.filter(m=>m.catalogueSource!=='opencode-live'&&m.accessUnchecked!==true);
 const candidates=listed.length?listed:models;
 const free=candidates.filter(m=>m.verified);
 return bestCodingModel(free.length?free:candidates);
}
function upstreamMessage(data) {
 const value=data?.error?.message??data?.error??data?.message;
 return typeof value==='string'?value.slice(0,500):'';
}
export function catalogueError(status,data,name='Router') {
 const detail=upstreamMessage(data);
 const guidance=name==='Google AI Studio'&&(status===400||status===401||status===403)?'Check your Google AI Studio API key at aistudio.google.com/apikey.':name==='NVIDIA NIM'&&(status===401||status===403)?'Check your NVIDIA NIM API key and available account credits at build.nvidia.com.':status===401?'Check the API key for this exact router address.':status===403?'Check the API key’s model permissions and the enabled provider connections.':status===404?'Check the API base URL; it must expose /models.':status===429?'The provider is rate limited. Wait for its reset, then refresh.':status>=500?'The router or its upstream provider is unavailable. Check its dashboard, then refresh.':'Check the router address, key, and provider connections.';
 return new Error(name+' returned '+status+'. '+guidance+(detail?' '+detail:''));
}
async function fetchProxyCatalogue(config,key,signal) {
 const base=normalizeEndpoint(config.proxyUrl);
 let r;
 try{r=await fetch(base+'/models',{redirect:'error',headers:key?{Authorization:'Bearer '+key}:{},signal})}catch(e){
   if(signal?.aborted){if(signal.reason?.name==='TimeoutError')throw new Error('The model catalogue request timed out. Check that the router is running and its providers are responding, then refresh.');throw e}
   if(config.proxyPreset==='freeride')throw new Error('FreeRide is not running at this address. In the Windows app, click Set up & connect FreeRide to start or repair the gateway using your saved provider keys.');
  const isHttps=typeof location!=='undefined'&&location.protocol==='https:';
  const isLocalHttp=/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])/i.test(base);
  if(isHttps&&isLocalHttp)throw new Error('Browsers block HTTPS web pages (MicoCode.vercel.app) from calling local HTTP routers (127.0.0.1). Use the MicoCode Windows app for automatic local routing, or use an HTTPS tunnel/proxy.');
  throw new Error('Could not reach the router. Start it, use its final API URL without redirects, allow this site in CORS, and allow local-network access when your browser asks.');
 }
 let data;try{data=await r.json()}catch{if(!r.ok)throw catalogueError(r.status,null);throw new Error('The router returned a non-JSON model catalogue. Check its API base URL; a dashboard URL cannot serve models.')}
 if(!r.ok)throw catalogueError(r.status,data,proxyPresets.find(p=>p.id===config.proxyPreset)?.name||'Router');
 return data;
}
// Full router catalogue: every exposed model, flagged when the router reports zero pricing.
// Unlike discoverProxy, this never hides models; selection stays the user's choice.
export async function listProxyModels(config,key,signal) {
  if(['horde','opencode','nim','aistudio'].includes(config.proxyPreset)) {
   const r=await fetch('/api/'+config.proxyPreset,{method:'POST',headers:{'Content-Type':'application/json',...(['nim','aistudio'].includes(config.proxyPreset)&&key?{Authorization:'Bearer '+key}:{})},body:JSON.stringify({action:'models'}),signal});
  const name=presetName(config.proxyPreset);
  const d=await r.json().catch(()=>null);if(!r.ok)throw catalogueError(r.status,d,name);
  if(!Array.isArray(d?.models))throw new Error(name+' returned an invalid model list. Restart or update MicoCode, then refresh the catalogue.');
  return d.models;
 }
  const d=await fetchProxyCatalogue(config,key,signal);
  let models=fullCatalogue(d);
  if(config.proxyPreset==='freeride'&&!models.some(m=>m.id==='freeride/auto'))models.push({id:'freeride/auto',name:'FreeRide Auto · cross-provider failover',provider:'FreeRide',verified:false,paid:false});
  if(config.proxyPreset==='9router'&&config.managed!==true) {
  try{
   const discoverySignal=signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000);
   // This fixed public relay never receives the user's router credential.
   const free=await listProxyModels({proxyPreset:'opencode'},'',discoverySignal);
   models=supplementOpenCodeModels(models,free);
   if(!free.length)models.catalogueWarning='OpenCode returned no currently verified free text models. Your router catalogue is still available.';
  }catch(error){
   if(signal?.aborted&&signal.reason?.name!=='TimeoutError')throw error;
   models.catalogueWarning='OpenCode free model discovery is unavailable. Your router catalogue is still available; refresh later to discover additional free models.';
  }
 }
 if(!models.length)throw new Error(config.proxyPreset==='9router'?'9Router returned an empty model list. Check that the API key belongs to this router, is unrestricted (or allows these models), and that providers and models are enabled in its dashboard.':'The router returned no models. Check its address and key, then try again. You can still type a model ID below.');
 return models;
}
export async function discoverProxy(config,key,signal) {
  if(['9router','horde','opencode','nim','aistudio','freeride'].includes(config.proxyPreset))return listProxyModels(config,key,signal);
 const d=await fetchProxyCatalogue(config,key,signal);
 const models=freeCatalogue(d,config.freeModels,config.routerFreeOnly);
 if(!models.length)throw new Error('No free routes verified. If your router omits pricing, add exact free model IDs below and confirm free-only routing. Paid or unknown models stay hidden.');
 return models;
}
function presetName(id){return proxyPresets.find(p=>p.id===id)?.name||'Router'}
