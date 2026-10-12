import {fullCatalogue} from '../lib/mico/providers.mjs';

export const AIHUBMIX_BASE='https://aihubmix.com/v1';
const NON_TEXT=/^(text-)?(embedding|moderation|dall-e)|-(tts|stt|realtime|whisper|dall-e|image|audio|embed)\b|rerank|flux|sdxl|midjourney/i;

function providerOfAihubModel(id:string){
 const s=id.toLowerCase();
 if(s.startsWith('claude'))return 'Anthropic';
 if(s.startsWith('gpt')||s.startsWith('o1')||s.startsWith('o3')||s.startsWith('chatgpt'))return 'OpenAI';
 if(s.startsWith('gemini')||s.startsWith('gemma'))return 'Google';
 if(s.startsWith('deepseek'))return 'DeepSeek';
 if(s.startsWith('qwen'))return 'Qwen';
 if(s.startsWith('glm'))return 'Zhipu';
 if(s.startsWith('kimi')||s.startsWith('moonshot'))return 'Moonshot';
 if(s.startsWith('llama'))return 'Meta';
 if(s.startsWith('mistral')||s.startsWith('codestral')||s.startsWith('devstral'))return 'Mistral';
 return 'AIHubMix';
}

function normalizeAiHubMixCatalogue(raw:unknown){
 const data=raw as {data?:Record<string,unknown>[];models?:Record<string,unknown>[]}|null;
 const list=Array.isArray(data?.data)?data.data:Array.isArray(data?.models)?data.models:[];
 const items=list.filter(m=>{
  if(!m||typeof m!=='object')return false;
  const id=typeof m.id==='string'?m.id:typeof m.name==='string'?m.name:'';
  if(!id||NON_TEXT.test(id))return false;
  return true;
 }).map(m=>{
  const id=String(m.id||m.name||'').trim();
  const provider=providerOfAihubModel(id);
  const contextLength=Number(m.context_length??m.context??m.max_context_length)||(
   /gemini/i.test(id)?1048576:/claude|o1|o3|gpt-4o/i.test(id)?128000:/deepseek|qwen/i.test(id)?65536:32768
  );
  return {
   ...m,
   id,
   name:typeof m.name==='string'&&m.name&&m.name!==id?m.name:`${id} (${provider})`,
   owned_by:provider,
   context_length:contextLength,
   max_completion_tokens:Number(m.max_completion_tokens??m.max_output_tokens)||4096,
  };
 });
 return fullCatalogue({data:items});
}

export function createAiHubMixHandler(fetcher:typeof fetch=fetch){
 return async function POST(request:Request){
  const headers:Record<string,string>={'Cache-Control':'no-store'};
  const fail=(error:string,status=400)=>Response.json({error},{status,headers});
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return fail('Origin is not allowed.',403);
  const auth=request.headers.get('authorization')||'',key=auth.slice(7);
  if(!/^Bearer [\w.~-]{10,2048}$/.test(auth))return fail('Add your AIHubMix API key in Connections.',401);
  try{
   const raw=await request.text();if(raw.length>300000)return fail('Request is too large.',413);
   const body=JSON.parse(raw);if(!body||!['models','complete'].includes(body.action))return fail('Unsupported AIHubMix request.');
   let payload;
   if(body.action==='complete'){
    if(typeof body.model!=='string'||!body.model.trim()||body.model.length>=200)return fail('Select an AIHubMix model.');
    if(!Array.isArray(body.messages)||!body.messages.length||body.messages.length>80||!body.messages.every((m:{role:string;content:string})=>m&&['system','user','assistant'].includes(m.role)&&typeof m.content==='string'))return fail('Invalid coding messages.');
    payload={model:body.model.trim(),messages:body.messages,stream:false,max_tokens:4096,temperature:typeof body.temperature==='number'?Math.max(0,Math.min(1,body.temperature)):0.2};
   }
   const response=await fetcher(AIHUBMIX_BASE+(payload?'/chat/completions':'/models'),{method:payload?'POST':'GET',redirect:'error',headers:{Authorization:auth,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.any([request.signal,AbortSignal.timeout(payload?180000:20000)])});
   for(const name of ['retry-after','x-ratelimit-remaining','x-ratelimit-reset']){const value=response.headers.get(name);if(value)headers[name]=value}
   if(!response.ok){
    const text=await response.text();let data;try{data=JSON.parse(text)}catch{}
    const detail=data?.error?.message||data?.detail||data?.message||text.slice(0,300);
    const guidance=[401,403].includes(response.status)?'AIHubMix rejected this key. Check your API key at aihubmix.com.':response.status===402?'AIHubMix account balance or credits are exhausted.':response.status===429?'AIHubMix rate limit reached. Wait for reset or try another model.':response.status===404?'This AIHubMix model is currently unavailable. Choose another model.':'AIHubMix could not complete the request.';
    return fail((guidance+(detail?' '+String(detail):'')).replaceAll(key,'[redacted]'),response.status);
   }
   if(!payload)return Response.json({models:normalizeAiHubMixCatalogue(await response.json()),requiresKey:true},{headers});
   const text=await response.text();headers['Content-Type']=response.headers.get('content-type')||'application/json';
   return new Response(text,{status:response.status,headers});
  }catch(error){
   if(error instanceof SyntaxError)return fail('Invalid AIHubMix request or catalogue.',400);
   return fail(error instanceof Error&&error.name==='TimeoutError'?'AIHubMix took too long to respond. Retry or choose another model.':'AIHubMix could not be reached. Check your connection and retry.',502);
  }
 };
}
export const POST=createAiHubMixHandler();
export default {fetch(request:Request){return request.method==='POST'?POST(request):new Response('Method not allowed.',{status:405})}};
