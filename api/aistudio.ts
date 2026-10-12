import {fullCatalogue} from '../lib/mico/providers.mjs';

export const AISTUDIO_BASE='https://generativelanguage.googleapis.com/v1beta/openai';
const NON_TEXT=/^(models\/)?((text-|gemini-)?embedding|imagen|veo|aqa|chirp|lyria|learnlm)|-(tts|embedding|image-generation)\b/i;

function normalizeAiStudioCatalogue(raw:unknown){
 const data=raw as {data?:Record<string,unknown>[];models?:Record<string,unknown>[]}|null;
 const list=Array.isArray(data?.data)?data.data:Array.isArray(data?.models)?data.models:[];
 const items=list.filter(m=>{
  if(!m||typeof m!=='object')return false;
  const rawId=typeof m.id==='string'?m.id:typeof m.name==='string'?m.name:'';
  if(!rawId||NON_TEXT.test(rawId))return false;
  if(Array.isArray(m.supportedGenerationMethods)&&!m.supportedGenerationMethods.includes('generateContent'))return false;
  return true;
 }).map(m=>{
  const rawId=String(typeof m.id==='string'?m.id:m.name||'');
  const id=rawId.replace(/^models\//,'');
  const displayName=typeof m.displayName==='string'&&m.displayName?m.displayName:typeof m.name==='string'&&!m.name.startsWith('models/')?m.name:id;
  const contextLength=Number(m.context_length??m.inputTokenLimit)||(/gemini-[23]/i.test(id)?1048576:undefined);
  const maxOutput=Number(m.max_completion_tokens??m.outputTokenLimit)||(/gemini-2\.5/i.test(id)?65536:undefined);
  return {
   ...m,
   id,
   name:displayName,
   owned_by:typeof m.owned_by==='string'&&m.owned_by&&m.owned_by!=='google'?m.owned_by:'Google AI Studio',
   ...(contextLength?{context_length:contextLength}:{}),
   ...(maxOutput?{max_completion_tokens:maxOutput}:{}),
  };
 });
 return fullCatalogue({data:items});
}

export function createAiStudioHandler(fetcher:typeof fetch=fetch){
 return async function POST(request:Request){
  const headers:Record<string,string>={'Cache-Control':'no-store'};
  const fail=(error:string,status=400)=>Response.json({error},{status,headers});
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return fail('Origin is not allowed.',403);
  const auth=request.headers.get('authorization')||'',key=auth.slice(7);
  if(!/^Bearer [\w.~-]{10,2048}$/.test(auth))return fail('Add your Google AI Studio API key to connect.',401);
  try{
   const raw=await request.text();if(raw.length>300000)return fail('Request is too large.',413);
   const body=JSON.parse(raw);if(!body||!['models','complete'].includes(body.action))return fail('Unsupported Google AI Studio request.');
   let payload;
   if(body.action==='complete'){
    if(typeof body.model!=='string'||!body.model.trim()||body.model.length>=200)return fail('Select a Google AI Studio model.');
    if(!Array.isArray(body.messages)||!body.messages.length||body.messages.length>80||!body.messages.every((m:{role:string;content:string})=>m&&['system','user','assistant'].includes(m.role)&&typeof m.content==='string'))return fail('Invalid coding messages.');
    const model=body.model.trim().replace(/^models\//,'');
    payload={model,messages:body.messages,stream:false,max_tokens:4096,temperature:typeof body.temperature==='number'?Math.max(0,Math.min(1,body.temperature)):0.2};
   }
   const response=await fetcher(AISTUDIO_BASE+(payload?'/chat/completions':'/models'),{method:payload?'POST':'GET',redirect:'error',headers:{Authorization:auth,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.any([request.signal,AbortSignal.timeout(payload?180000:20000)])});
   for(const name of ['retry-after','x-ratelimit-remaining','x-ratelimit-reset']){const value=response.headers.get(name);if(value)headers[name]=value}
   if(!response.ok){
    const text=await response.text();let data;try{data=JSON.parse(text)}catch{}
    const detail=data?.error?.message||data?.[0]?.error?.message||data?.detail||data?.message||text.slice(0,300);
    const guidance=[400,401,403].includes(response.status)&&/API_KEY|key|auth|permission|unauthenticated/i.test(String(detail)||String(response.status))||[401,403].includes(response.status)?'Google AI Studio rejected this key. Create or check your API key at aistudio.google.com/apikey.':response.status===429?'Google AI Studio rate limit reached. Wait for quota reset or switch models.':response.status===404?'This Gemini model is unavailable. Refresh the catalogue and choose another model.':'Google AI Studio could not complete the request.';
    return fail((guidance+(detail?' '+String(detail):'')).replaceAll(key,'[redacted]'),response.status);
   }
   if(!payload)return Response.json({models:normalizeAiStudioCatalogue(await response.json()),requiresKey:true},{headers});
   const text=await response.text();headers['Content-Type']=response.headers.get('content-type')||'application/json';
   return new Response(text,{status:response.status,headers});
  }catch(error){
   if(error instanceof SyntaxError)return fail('Invalid Google AI Studio request or catalogue.',400);
   return fail(error instanceof Error&&error.name==='TimeoutError'?'Google AI Studio took too long to respond. Retry or choose a faster Gemini model.':'Google AI Studio could not be reached. Check your connection and retry.',502);
  }
 };
}
export const POST=createAiStudioHandler();
export default {fetch(request:Request){return request.method==='POST'?POST(request):new Response('Method not allowed.',{status:405})}};
