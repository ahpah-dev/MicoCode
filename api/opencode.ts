import {loadOpenCodeModels, openCodeErrorMessage, openCodeRequest, readOpenCodeCompletion} from '../lib/mico/opencode.mjs';

export function createOpenCodeHandler(fetcher:typeof fetch = fetch) {
 let catalogue:{expires:number;models:Awaited<ReturnType<typeof loadOpenCodeModels>>}|undefined;
 async function models(signal:AbortSignal) {
  if (catalogue && catalogue.expires > Date.now()) return catalogue.models;
  const available = await loadOpenCodeModels(fetcher, signal);
  catalogue = {expires:Date.now()+60000, models:available};
  return available;
 }
 return async function POST(request:Request) {
  const headers:Record<string,string> = {'Cache-Control':'no-store'};
  const fail = (error:string,status=400) => Response.json({error},{status,headers});
  let key = '';
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return fail('Origin is not allowed.',403);
  try {
   const raw = await request.text();
   if (raw.length > 300000) return fail('Request is too large.',413);
   const body = JSON.parse(raw);
   if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Invalid request.');
   const discoverySignal = AbortSignal.any([request.signal,AbortSignal.timeout(20000)]);
   if (body.action === 'models') return Response.json({models:await models(discoverySignal),requiresKey:true,authorization:'unchecked'},{headers});
   if (body.action !== 'complete') return fail('Unsupported request.');
   const auth = request.headers.get('authorization') || '';
   if (!/^Bearer [\w.~-]{10,400}$/.test(auth)) return fail('Add your OpenCode Zen API key in Connections. The public model catalogue does not verify generation access.',401);
   key = auth.slice(7);
   if (typeof body.model !== 'string') return fail('Choose a free OpenCode model in Connections.');
   if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 60 || !body.messages.every((m:{role:string;content:string}) => m && ['system','user','assistant'].includes(m.role) && typeof m.content === 'string')) return fail('Invalid messages.');
   const model = (await models(discoverySignal)).find((m:{id:string}) => m.id === body.model);
   if (!model) return fail('This model is not currently verified as a free OpenCode text model. Refresh the model list and choose an available free model.');
   const temperature = typeof body.temperature === 'number' && Number.isFinite(body.temperature) ? Math.max(0,Math.min(1,body.temperature)) : 0.2;
   const upstreamRequest = openCodeRequest(model,body.messages,temperature);
   const upstream = await fetcher(upstreamRequest.url, {
    method:'POST',redirect:'error',
    headers:{'Content-Type':'application/json',...(model.protocol === 'messages' ? {'x-api-key':key,'anthropic-version':'2023-06-01'} : {Authorization:auth})},
    body:JSON.stringify(upstreamRequest.body),
    signal:AbortSignal.any([request.signal,AbortSignal.timeout(120000)]),
   });
   for (const name of ['retry-after','x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-reset']) {const value = upstream.headers.get(name); if (value) headers[name] = value;}
   if (!upstream.ok) {
    const data = await upstream.json().catch(() => ({}));
    return fail(openCodeErrorMessage(data,upstream.status,key),upstream.status);
   }
   const content = await readOpenCodeCompletion(upstream,model.protocol);
   return Response.json({model:model.id,choices:[{message:{role:'assistant',content},finish_reason:'stop'}]},{headers});
  } catch (error) {
   if (error instanceof SyntaxError) return fail('Invalid JSON request or provider response.');
   if (error instanceof Error && ['TimeoutError','AbortError'].includes(error.name)) return fail('OpenCode request was stopped or timed out. Retry when the connection is available.',504);
   return fail(error instanceof Error ? error.message.replaceAll(key || '\0','[redacted]') : 'OpenCode is unavailable. Try again later.',502);
  }
 };
}
export const POST = createOpenCodeHandler();
export default {fetch(request:Request) {return request.method === 'POST' ? POST(request) : new Response('Method not allowed.',{status:405,headers:{Allow:'POST'}});}};
