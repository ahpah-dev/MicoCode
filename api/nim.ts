import {fullCatalogue} from '../lib/mico/providers.mjs';

export const NIM_BASE='https://integrate.api.nvidia.com/v1';
export function createNimHandler(fetcher:typeof fetch=fetch){
 return async function POST(request:Request){
  const headers:Record<string,string>={'Cache-Control':'no-store'};
  const fail=(error:string,status=400)=>Response.json({error},{status,headers});
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return fail('Origin is not allowed.',403);
  const auth=request.headers.get('authorization')||'',key=auth.slice(7);
  if(!/^Bearer [\w.~-]{10,2048}$/.test(auth))return fail('Add your NVIDIA Build API key to connect NIM.',401);
  try{
   const raw=await request.text();if(raw.length>300000)return fail('Request is too large.',413);
   const body=JSON.parse(raw);if(!body||!['models','complete'].includes(body.action))return fail('Unsupported NIM request.');
   let payload;
   if(body.action==='complete'){
    if(typeof body.model!=='string'||!body.model.trim()||body.model.length>=200)return fail('Select a NIM model.');
    if(!Array.isArray(body.messages)||!body.messages.length||body.messages.length>80||!body.messages.every((m:{role:string;content:string})=>m&&['system','user','assistant'].includes(m.role)&&typeof m.content==='string'))return fail('Invalid coding messages.');
    payload={model:body.model,messages:body.messages,stream:false,max_tokens:4096,temperature:typeof body.temperature==='number'?Math.max(0,Math.min(1,body.temperature)):0.2};
   }
   const response=await fetcher(NIM_BASE+(payload?'/chat/completions':'/models'),{method:payload?'POST':'GET',redirect:'error',headers:{Authorization:auth,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.any([request.signal,AbortSignal.timeout(payload?180000:20000)])});
   for(const name of ['retry-after','x-ratelimit-remaining','x-ratelimit-reset']){const value=response.headers.get(name);if(value)headers[name]=value}
   if(!response.ok){
    const text=await response.text();let data;try{data=JSON.parse(text)}catch{}
    const detail=data?.error?.message||data?.detail||data?.message||text.slice(0,300);
    const guidance=[401,403].includes(response.status)?'NVIDIA rejected this key. Generate a valid API key at build.nvidia.com.':response.status===402?'NVIDIA account credits are exhausted.':response.status===429?'NVIDIA is rate limited. Wait for its reset or use another configured provider.':response.status===404?'This NIM model is unavailable. Refresh the catalogue and choose another model.':'NVIDIA could not complete the request.';
    return fail((guidance+(detail?' '+String(detail):'')).replaceAll(key,'[redacted]'),response.status);
   }
   if(!payload)return Response.json({models:fullCatalogue(await response.json()),requiresKey:true},{headers});
   // Preserve the upstream completion envelope (including length/reasoning) or SSE.
   const text=await response.text();headers['Content-Type']=response.headers.get('content-type')||'application/json';
   return new Response(text,{status:response.status,headers});
  }catch(error){
   if(error instanceof SyntaxError)return fail('Invalid NIM request or catalogue.',400);
   return fail(error instanceof Error&&error.name==='TimeoutError'?'NVIDIA took too long to respond. Retry or choose a faster model.':'NVIDIA could not be reached. Check your connection and retry.',502);
  }
 };
}
export const POST=createNimHandler();
export default {fetch(request:Request){return request.method==='POST'?POST(request):new Response('Method not allowed.',{status:405})}};
