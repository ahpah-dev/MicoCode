import http from 'node:http';
import path from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {POST as horde} from '../api/horde.ts';
import {POST as ai} from '../api/ai.ts';
import {POST as connection} from '../api/connection.ts';
import {GET as models} from '../api/models.ts';
import {POST as opencode} from '../api/opencode.ts';
import {actionSchema} from '../lib/mico/action-schema.mjs';

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.zip':'application/zip','.wasm':'application/wasm','.woff2':'font/woff2'};
const json=(error,status=400)=>Response.json({error},{status});
async function routerBody(response){
 if(!response.body)return null;
 const reader=response.body.getReader(),chunks=[];let bytes=0,complete=false;
 try{
  while(true){const {value,done}=await reader.read();if(done){complete=true;break}bytes+=value.byteLength;if(bytes>16*1024*1024){const error=new Error('Router response exceeded its size limit.');error.code='MICO_RESPONSE_LIMIT';throw error}chunks.push(value)}
  return Buffer.concat(chunks,bytes);
 }finally{if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock()}
}
export function isLocalRequest(request,origin){return new URL(request.url).origin===origin&&(!request.headers.get('origin')||request.headers.get('origin')===origin)&&request.headers.get('sec-fetch-site')!=='cross-site'}
export function managedClientConnection(connection,origin){
 if(!connection||connection.config.provider!=='proxy')return connection;
 const id=connection.config.proxyPreset;
 if(!['9router','cliproxy','litellm'].includes(id))throw new Error('Unsupported managed router.');
 return {...connection,config:{...connection.config,proxyUrl:origin+'/providers/'+id+'/v1'}};
}
export function managedRouterCatalogue(data,connection){
 if(connection?.config?.proxyPreset!=='9router'||!Array.isArray(connection.openCodeFreeModels))return data;
 const field=Array.isArray(data?.data)?'data':Array.isArray(data?.models)?'models':null;
 if(!field)return data;
 const existing=new Set(data[field].map(m=>m?.id));
 const extra=connection.openCodeFreeModels.filter(m=>m&&typeof m.id==='string'&&m.id.startsWith('oc/')&&m.catalogueSource==='opencode-live'&&m.pricing?.prompt==='0'&&m.pricing?.completion==='0'&&!existing.has(m.id));
 return {...data,[field]:[...data[field],...extra]};
}
export async function createLocalServer({webDir,port=19286,gatewayKey,getOllamaUpstream=()=>null,getOllamaModel=()=>null,getOllamaModels=()=>null,getManagedConnection=()=>null,fetchImpl=fetch}){
 let origin='http://127.0.0.1:'+port;
 async function handle(request){
  if(!isLocalRequest(request,origin))return json('Origin is not allowed.',403);
  const url=new URL(request.url),route=url.pathname;
  const providerRoute=route.match(/^\/providers\/(9router|cliproxy|litellm)\/v1\/(models|chat\/completions)$/);
  if(providerRoute){
   const [,id,action]=providerRoute,connection=getManagedConnection(id);
   if(!connection)return json('Your managed router is stopped. Open Models and click Set up & connect.',503);
   if(!connection.key||request.headers.get('authorization')!=='Bearer '+connection.key)return json('Reconnect your managed router to refresh its protected connection.',401);
   const expected=action==='models'?'GET':'POST';if(request.method!==expected)return json('Method not allowed.',405);
   const target=new URL(connection.config.proxyUrl);
   if(target.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(target.hostname)||target.username||target.password||target.search||target.hash||target.pathname!=='/v1')return json('Invalid managed router configuration. Reconnect in Models.',503);
    let body;
    if(expected==='POST'){
     body=await request.json();
      if(typeof body.model!=='string'||!body.model.trim()||body.model.length>=200)return json('Select a valid router model.');
      // 9Router owns its provider catalogue and enforces API-key access itself.
      // Its connected provider models are not limited to MicoCode's local engine.
      const allowed=new Set([connection.config.model,...(Array.isArray(connection.config.freeModels)?connection.config.freeModels:[])]);
      if(id!=='9router'&&!allowed.has(body.model))return json('This managed router supports only its configured free models.');
     if(!Array.isArray(body.messages)||!body.messages.length||body.messages.length>80||!body.messages.every(m=>m&&['system','user','assistant'].includes(m.role)&&typeof m.content==='string'))return json('Invalid coding messages.');
     body={model:body.model,messages:body.messages,temperature:body.temperature,max_tokens:body.max_tokens,stream:false};
    }
   try{
    const r=await fetchImpl(target.href.replace(/\/$/,'')+'/'+action,{method:expected,redirect:'error',headers:{Authorization:'Bearer '+connection.key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.any([request.signal,AbortSignal.timeout(action==='models'?20000:610000)])});
    const headers={'Content-Type':r.headers.get('content-type')||'application/json','Cache-Control':'no-store'};
    for(const name of ['retry-after','x-ratelimit-remaining','x-ratelimit-reset']){const value=r.headers.get(name);if(value)headers[name]=value}
    // Do not commit successful headers until the non-streaming router response
    // finishes. A router process can exit after sending headers; forwarding that
    // partial body hides the connection error behind an invalid model reply.
    const data=await routerBody(r);
    if(id==='9router'&&action==='models'&&r.ok){const catalogue=JSON.parse(data.toString('utf8'));return Response.json(managedRouterCatalogue(catalogue,connection),{status:r.status,headers})}
    return new Response(data,{status:r.status,headers});
   }catch(e){if(request.signal.aborted)throw e;if(e.code==='MICO_RESPONSE_LIMIT')return json('The router response was too large. Try a smaller task or reduce the router model catalogue.',502);return json(e.name==='TimeoutError'?'The coding model took too long. Try a smaller local model or a shorter task.':'Your managed router stopped responding. Open Models and click Set up & connect.',e.name==='TimeoutError'?504:503)}
  }
  const managed=route.match(/^\/managed\/(local|community)\/v1\/(models|chat\/completions)$/);
  if(managed||route.startsWith('/managed/v1/')){
   if(request.headers.get('authorization')!=='Bearer '+gatewayKey)return json('A managed connection key is required.',401);
   const action=managed?.[2]||route.slice('/managed/v1/'.length),engine=managed?.[1]||'community';
    if(engine==='local'){
     const upstream=getOllamaUpstream(),inventory=typeof getOllamaModels==='function'?getOllamaModels():null;
     if(!upstream||!Array.isArray(inventory)||!inventory.length)return json('Set up the local coding engine first.',503);
     if(action==='models'&&request.method==='GET')return Response.json({object:'list',data:inventory.filter(m=>m&&typeof m.route==='string'&&m.route).map(m=>({id:m.route,name:typeof m.name==='string'?m.name:m.route,object:'model',owned_by:'micocode-local',pricing:{prompt:'0',completion:'0'}}))});
     if(action==='chat/completions'&&request.method==='POST'){
      const body=await request.json();const entry=inventory.find(m=>m&&m.route===body.model);
      if(!entry)return json('That local model is not installed. Re-run Set up & connect to refresh the list.',400);
      if(!Array.isArray(body.messages)||body.messages.length>80||!body.messages.every(m=>m&&['system','user','assistant'].includes(m.role)&&typeof m.content==='string'))return json('Invalid coding messages.');
      const requested=Number(body.max_tokens);const outputLimit=Number.isFinite(requested)&&requested>0?Math.min(4096,Math.max(1,Math.floor(requested))):4096;
      try{
       const r=await fetchImpl(upstream+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:entry.name,messages:body.messages,format:actionSchema,stream:false,think:false,options:{temperature:Math.max(0,Math.min(1,Number.isFinite(Number(body.temperature))?Number(body.temperature):.2)),num_predict:outputLimit}}),signal:AbortSignal.any([request.signal,AbortSignal.timeout(600000)])});
       const d=await r.json();if(!r.ok)return json('The local model could not finish this request.',r.status);
       return Response.json({id:'mico-'+Date.now(),object:'chat.completion',model:body.model,choices:[{index:0,message:{role:'assistant',content:d.message?.content||''},finish_reason:d.done_reason==='length'?'length':'stop'}],usage:{prompt_tokens:d.prompt_eval_count||0,completion_tokens:d.eval_count||0}});
      }catch(e){if(request.signal.aborted)throw e;return json(e.name==='TimeoutError'?'The local coding model took too long. Try a smaller model or a shorter task.':'The local coding engine stopped responding. Reconnect it in Models.',e.name==='TimeoutError'?504:503)}
     }return json('Unsupported managed route.',404);
    }
   if(action==='models'&&request.method==='GET'){
    // Verify real anonymous community availability, then expose one stable free route to each router.
    const r=await horde(new Request(origin+'/api/horde',{method:'POST',body:JSON.stringify({action:'models'})}));const d=await r.json();
    if(!r.ok)return json(d.error,r.status);if(!d.models?.length)return json('No free community workers are available. Retry later or set up Ollama for local inference.',503);
    return Response.json({object:'list',data:[{id:'free-code',object:'model',owned_by:'micocode-community',pricing:{prompt:'0',completion:'0'}}]});
   }
   if(action==='chat/completions'&&request.method==='POST'){
    const body=await request.json();if(body.model!=='free-code')return json('This managed route supports only its configured free model.');
    const r=await horde(new Request(origin+'/api/horde',{method:'POST',body:JSON.stringify({action:'models'})}));const d=await r.json();if(!r.ok)return json(d.error,r.status);
    const available=d.models||[];const model=available.find(m=>/qwen3|deepseek|devstral|gemma-?4|glm-?5|kimi/i.test(m.id))?.id||available.find(m=>/coder|instruct/i.test(m.id))?.id||available[0]?.id;
    if(!model)return json('No free community workers are available. Try Ollama or retry later.',503);
    return horde(new Request(origin+'/api/horde',{method:'POST',body:JSON.stringify({action:'complete',model,messages:body.messages,temperature:body.temperature})}));
   }return json('Unsupported managed route.',404);
  }
  if(route.startsWith('/managed/ollama/')){
   const upstream=getOllamaUpstream();if(!upstream)return json('Set up Ollama in Connections first.',503);
   const suffix=route.slice('/managed/ollama'.length);
   if(!(request.method==='GET'&&suffix==='/api/tags')&&!(request.method==='POST'&&suffix==='/api/chat'))return json('Unsupported local model route.',404);
   try{
    const response=await fetchImpl(upstream+suffix,{method:request.method,headers:{'Content-Type':'application/json'},...(request.method==='POST'?{body:await request.text()}:{}),signal:AbortSignal.any([request.signal,AbortSignal.timeout(request.method==='POST'?600000:20000)])});
    const data=await routerBody(response);
    return new Response(data,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
   }catch(e){if(request.signal.aborted)throw e;if(e.code==='MICO_RESPONSE_LIMIT')return json('The local model response was too large. Try a smaller task.',502);return json(e.name==='TimeoutError'?'The local coding model took too long. Try a smaller model or a shorter task.':'The local coding engine stopped responding. Reconnect it in Models.',e.name==='TimeoutError'?504:503)}
  }
  const api=route==='/api/horde'?horde:route==='/api/ai'?ai:route==='/api/connection'?connection:route==='/api/models'?models:route==='/api/opencode'?opencode:null;
  if(api)return request.method===(route==='/api/models'?'GET':'POST')?api(request):json('Method not allowed.',405);
  if(request.method!=='GET')return json('Method not allowed.',405);
  if(route==='/app')return new Response(null,{status:302,headers:{Location:'/app/'}});
  let relative=decodeURIComponent(route);if(relative.endsWith('/'))relative+='index.html';
  const file=path.resolve(webDir,'.'+relative);if(!file.startsWith(path.resolve(webDir)+path.sep))return json('Invalid path.',403);
  try{const data=await readFile(file);return new Response(data,{headers:{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':route.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https: http://127.0.0.1:* http://localhost:*; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'"}})}catch{return json('Not found.',404)}
 }
 const server=http.createServer(async(req,res)=>{
  const abort=new AbortController();res.on('close',()=>{if(!res.writableEnded)abort.abort()});
  try{
   if(req.headers.host!==new URL(origin).host){res.writeHead(403);res.end('Invalid host.');return}
   let bytes=0;const parts=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>200000){res.writeHead(413);res.end('Request is too large.');return}parts.push(chunk)}
   const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(parts.length?{body:Buffer.concat(parts)}:{}),signal:abort.signal});
   const response=await handle(request);res.writeHead(response.status,Object.fromEntries(response.headers));
   if(response.body)for await(const chunk of response.body){if(!res.write(chunk))await new Promise(resolve=>res.once('drain',resolve))}res.end();
  }catch(e){if(!res.headersSent)res.writeHead(e instanceof SyntaxError?400:502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e instanceof SyntaxError?'Invalid request.':'The local request could not finish. Please retry.'}))}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});origin='http://127.0.0.1:'+server.address().port;
 return {origin,handle,server,close:()=>new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();server.closeAllConnections()})};
}
