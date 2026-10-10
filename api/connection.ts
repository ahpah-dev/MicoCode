export async function POST(request:Request){
 if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Origin is not allowed.'},{status:403});
 const auth=request.headers.get('authorization')||'';if(!/^Bearer [\w.-]{10,400}$/.test(auth))return Response.json({error:'Enter your OpenRouter API key.'},{status:401});
 try{const r=await fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:auth},signal:AbortSignal.timeout(15000)});const d=await r.json() as {error?:{message?:string};data?:{free_model_daily_requests?:unknown}};if(!r.ok)return Response.json({error:d.error?.message||'Key verification failed.'},{status:r.status});return Response.json({ok:true,quota:d.data?.free_model_daily_requests||null},{headers:{'Cache-Control':'no-store'}})}catch{return Response.json({error:'OpenRouter could not be reached. Try again.'},{status:502})}
}

export default {fetch(request:Request){if(request.method!=='POST')return new Response('Method not allowed.',{status:405,headers:{Allow:'POST'}});return POST(request)}};
