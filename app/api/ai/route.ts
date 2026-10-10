export async function POST(request:Request) {
 const headers={'Cache-Control':'no-store'};
 const fail=(error:string,status=400)=>Response.json({error},{status,headers});
 if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return fail('Origin is not allowed.',403);
 const auth=request.headers.get('authorization')||'';
 if(!/^Bearer [\w.-]{10,400}$/.test(auth))return fail('Add your OpenRouter API key in Connections.',401);
 try {
  const raw=await request.text();if(raw.length>300000)return fail('Request is too large.',413);
  const body=JSON.parse(raw);
  if(typeof body.model!=='string'||!(body.model==='openrouter/free'||body.model.endsWith(':free')))return fail('MicoCode only routes to free OpenRouter models.');
  if(!Array.isArray(body.messages)||body.messages.length>60||!body.messages.every((m:{role:string;content:string})=>['system','user','assistant'].includes(m.role)&&typeof m.content==='string'))return fail('Invalid messages.');
  const upstream=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:auth,'HTTP-Referer':new URL(request.url).origin,'X-OpenRouter-Title':'MicoCode'},body:JSON.stringify({model:body.model,messages:body.messages,stream:false,temperature:Math.max(0,Math.min(1,Number(body.temperature)||0.2)),max_tokens:4096,response_format:{type:'json_object'},provider:{max_price:{prompt:0,completion:0}}}),signal:AbortSignal.timeout(120000)});
  const data=await upstream.json();
  return Response.json(data,{status:upstream.status,headers:{...headers,...(upstream.headers.get('retry-after')?{'Retry-After':upstream.headers.get('retry-after')!}:{})}});
 }catch(e){return fail(e instanceof Error && e.name==='TimeoutError'?'Provider timed out. Try another free model.':'Could not complete the model request. Check the connection and try again.',502)}
}
