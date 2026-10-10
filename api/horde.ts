// Fixed, documented anonymous endpoint. Never relay user-supplied URLs or credentials.
type HordeModel={id:string;known_to_horde?:boolean;worker_threads?:number;template?:string};
let catalogue:{expires:number;models:{id:string;name:string}[]}|undefined;
async function models(){
 if(catalogue&&catalogue.expires>Date.now())return catalogue.models;
 const r=await fetch('https://oai.aihorde.net/v1/models',{redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error('AI Horde model discovery is unavailable.');
 const d=await r.json() as {data?:HordeModel[]};
 // Unknown chat templates can be listed with workers but fail generation in the proxy.
 const active=(d.data||[]).filter(m=>m.known_to_horde===true&&Number(m.worker_threads)>0&&['llama-3-instruct','chatml','alpaca','mistral-instruct'].includes(m.template||'')).map(m=>({id:m.id,name:m.id.replace(/^[^/]+\//,'')}));
 catalogue={expires:Date.now()+60000,models:active};return active;
}
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store'};
 const fail=(error:string,status=400)=>Response.json({error},{status,headers});
 if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return fail('Origin is not allowed.',403);
 try{
  const raw=await request.text();if(raw.length>100000)return fail('Request is too large.',413);
  const body=JSON.parse(raw);
  if(body.action==='models'){const available=await models();return Response.json({models:available},{headers})}
  if(body.action!=='complete')return fail('Unsupported request.');
  if(typeof body.model!=='string'||!(await models()).some(m=>m.id===body.model))return fail('Choose an active community model in Connections.');
  if(!Array.isArray(body.messages)||!body.messages.length||body.messages.length>30||!body.messages.every((m:{role:string;content:string})=>m&&['system','user','assistant'].includes(m.role)&&typeof m.content==='string'))return fail('Invalid messages.');
  const upstream=await fetch('https://oai.aihorde.net/v1/chat/completions',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer 0000000000'},body:JSON.stringify({model:body.model,messages:body.messages,max_tokens:1600,temperature:Math.max(0,Math.min(1,Number(body.temperature)||0.2)),stream:false,timeout:100}),signal:AbortSignal.timeout(110000)});
  const d=await upstream.json().catch(()=>({error:'The community proxy did not return a valid response. It is experimental; try another model or a different connection.'}));
  const forwarded:Record<string,string>={...headers};for(const name of ['retry-after','x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-reset']){const v=upstream.headers.get(name);if(v)forwarded[name]=v}
  return Response.json(d,{status:upstream.status,headers:forwarded});
 }catch(e){return fail(e instanceof SyntaxError?'Invalid request.':'AI Horde is unavailable or its volunteer queue timed out. Use another connection or retry later.',e instanceof SyntaxError?400:502)}
}
export default {fetch(request:Request){return request.method==='POST'?POST(request):new Response('Method not allowed.',{status:405,headers:{Allow:'POST'}})}};
