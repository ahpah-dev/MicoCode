export function retryDelay(headers,now=Date.now()) {
 const value=headers.get('retry-after');
 if(value!=null){const seconds=Number(value);if(Number.isFinite(seconds)&&seconds>=0)return seconds*1000;const date=Date.parse(value);if(Number.isFinite(date))return Math.max(0,date-now)}
 const reset=headers.get('x-ratelimit-reset')||headers.get('x-ratelimit-reset-requests');
 if(reset){const n=Number(reset);if(Number.isFinite(n)&&n>0)return Math.max(0,(n>1e12?n:n*1000)-now);const duration=/^(\d+(?:\.\d+)?)(ms|s|m)$/.exec(reset);if(duration)return Number(duration[1])*({ms:1,s:1000,m:60000}[duration[2]])}
 return 0;
}
export class ProviderError extends Error {
 constructor(message,status=502,retryAfterMs=0,exhausted=false){super(message);this.name='ProviderError';this.status=status;this.retryAfterMs=retryAfterMs;this.exhausted=exhausted}
}
export async function responseError(response,now=Date.now()) {
 const data=await response.clone().json().catch(()=>({}));
 const raw=typeof data.error==='string'?data.error:data.error?.message||data.error?.detail||data.message||data.detail||`Provider returned ${response.status}.`;
 const message=String(raw).slice(0,700);
 const source=data.error?.metadata?.limit_source||data.metadata?.limit_source||'';
 const isQuota=/daily|per.day|day quota|budget|credits? (?:exhausted|remaining|insufficient)|insufficient (?:quota|credits)|quota_exceeded|billing|spend.limit/i.test(message+' '+source);
 const exhausted=response.status===402||isQuota;
 return new ProviderError(message,response.status,retryDelay(response.headers,now),exhausted);
}
export function abortableSleep(ms,signal) {
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(new DOMException('Stopped','AbortError'));
  const stop=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);reject(new DOMException('Stopped','AbortError'))};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve()},ms);signal?.addEventListener('abort',stop,{once:true});
 });
}
export function createRequester({now=Date.now,sleep=abortableSleep,random=Math.random}={}) {
 const scopes=new Map();
 /** @param {()=>Promise<Response>} operation
  * @param {{scope?:string,signal?:AbortSignal,enabled?:boolean,paceMs?:number,onStatus?:(text:string)=>void}} [options] */
 return async function request(operation,{scope='default',signal,enabled=true,paceMs=0,onStatus=(_text)=>{}}={}) {
  let state=scopes.get(scope);if(!state){state={tail:Promise.resolve(),next:0};if(scopes.size>50)scopes.delete(scopes.keys().next().value);scopes.set(scope,state)}
  const prior=state.tail;let release;state.tail=new Promise(resolve=>{release=resolve});
  try {
   // Serialize generations on one connection. Abort still takes effect before sending.
   await prior;if(signal?.aborted)throw new DOMException('Stopped','AbortError');
   for(let attempt=0;attempt<3;attempt++) {
    const wait=Math.max(0,state.next-now());
    if(wait>60000)throw new ProviderError('This connection is cooling down. Wait for the provider reset or choose local AI.',429,wait,true);
    if(wait){if(wait>1000)onStatus(`Pacing requests · waiting ${Math.ceil(wait/1000)}s`);await sleep(wait,signal)}
    let response;
    try{response=await operation()}catch(e){if(signal?.aborted||e.name==='AbortError')throw e;if(e.name==='TimeoutError')throw new ProviderError('The coding model took too long to respond. Try a smaller local model or a shorter task.',504);throw new ProviderError('The router could not be reached. Check the address, CORS, and network connection.')}
    state.next=now()+(enabled?paceMs:0);
    if(response.ok){const remaining=response.headers.get('x-ratelimit-remaining');if(remaining!==null&&Number(remaining)===0)state.next=Math.max(state.next,now()+retryDelay(response.headers,now()));return response}
    const error=await responseError(response,now());
    if(error.retryAfterMs)state.next=Math.max(state.next,now()+error.retryAfterMs);
    if(error.exhausted){if(/daily|per.day|budget|insufficient.quota|quota_exceeded/i.test(error.message))state.next=Math.max(state.next,now()+300000);throw new ProviderError(error.message+' This route has exhausted its quota. Choose another enabled model/provider in your router or wait for the provider reset; MicoCode will not switch providers automatically.',error.status,error.retryAfterMs,true)}
    if(error.status===401)throw new ProviderError(error.message+(error.message.endsWith('.')?' ':' ')+'Check your API key for this router in Models.',401,0,false);
    if(error.status===403)throw new ProviderError(error.message+(error.message.endsWith('.')?' ':' ')+'Check router model permissions or enabled providers in its dashboard.',403,0,false);
    const transient=[429,500,502,503,504].includes(error.status);
    if(!enabled||!transient||attempt===2||error.retryAfterMs>60000)throw error;
    const delay=Math.max(error.retryAfterMs,Math.min(15000,1500*2**attempt+Math.floor(random()*750)));
    state.next=Math.max(state.next,now()+delay);
    onStatus(`Provider busy · retry ${attempt+1}/2 in ${Math.ceil(delay/1000)}s. You can stop at any time.`);
   }
   throw new ProviderError('Retry limit reached. Reconnect or try later.');
  }finally{release()}
 };
}
export const resilientRequest=createRequester();
