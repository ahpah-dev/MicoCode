import {ProviderError} from './resilience.mjs';

const textContent=value=>typeof value==='string'?value:Array.isArray(value)?value.filter(part=>part&&['text','output_text'].includes(part.type)&&typeof part.text==='string').map(part=>part.text).join(''):'';
const errorMessage=data=>typeof data?.error==='string'?data.error:typeof data?.error?.message==='string'?data.error.message:typeof data?.error?.detail==='string'?data.error.detail:typeof data?.detail==='string'?data.detail:typeof data?.message==='string'?data.message:undefined;

// Some compatible routers send SSE even when stream:false was requested.
// Read only assistant text; tool calls and reasoning are never executed as actions.
/** @param {Response} response @param {{local?:boolean,signal?:AbortSignal}} [options] */
export async function readModelText(response,{local=false,signal}={}) {
 let raw;
 try{raw=await response.text()}catch(e){
  if(signal?.aborted)throw new DOMException('Stopped','AbortError');
  throw new ProviderError(e?.name==='TimeoutError'?'The model response timed out. Try a shorter task.':'The router disconnected while sending its reply. Reconnect it in Models and try again.',e?.name==='TimeoutError'?504:503);
 }
 if(signal?.aborted)throw new DOMException('Stopped','AbortError');
 if(raw.length>16000000)throw new ProviderError('The model reply was too large. Ask for one focused file edit.',502);
 let content='',refusal='',limited=false,streamingReasoning='';
 if(/^(?:data:|event:|:)/m.test(raw)&&(/text\/event-stream/i.test(response.headers.get('content-type')||'')||raw.trimStart().startsWith('data:'))){
  let completed=false;
  for(const frame of raw.split(/\r?\n\r?\n/)){
   const payload=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
   if(payload==='[DONE]'){completed=true;continue}if(!payload)continue;
   let part;try{part=JSON.parse(payload)}catch{throw new ProviderError('The router sent an incomplete streaming reply. Reconnect it in Models and try again.',502)}
   if(errorMessage(part))throw new ProviderError(String(errorMessage(part)).slice(0,700),502);
   const choice=part.choices?.[0];
   const chunk=textContent(choice?.delta?.content??choice?.message?.content);
   if(chunk)content+=chunk;
   else if(choice?.delta?.reasoning_content)streamingReasoning+=textContent(choice.delta.reasoning_content);
   if(choice?.finish_reason)completed=true;
   if(choice?.finish_reason==='length')limited=true;
   if(typeof choice?.delta?.refusal==='string')refusal+=choice.delta.refusal;
  }
  if(!completed)throw new ProviderError('The router disconnected before its streaming reply finished. Reconnect it in Models and try again.',503);
  if(!content.trim()&&streamingReasoning.trim())content=streamingReasoning;
 }else{
  let data;try{data=JSON.parse(raw)}catch{throw new ProviderError('The router returned an unreadable reply instead of a chat completion. Check the API address and selected model in Models.',502)}
  if(errorMessage(data))throw new ProviderError(String(errorMessage(data)).slice(0,700),502);
  limited=local?data.done_reason==='length':data.choices?.[0]?.finish_reason==='length';
  const message=local?data.message:data.choices?.[0]?.message;
  content=textContent(message?.content);refusal=typeof message?.refusal==='string'?message.refusal:'';
  if(!content.trim()&&message?.reasoning_content)content=textContent(message.reasoning_content);
  else if(!content.trim()&&data.choices?.[0]?.text)content=textContent(data.choices[0].text);
 }
 if(limited)throw new ProviderError('The model reached its output limit before finishing. Ask for one smaller edit, or select a model with a larger output window.',422);
 if(!content.trim())throw new ProviderError(refusal?refusal.slice(0,700):'The model returned no assistant text. Check that this route supports chat generation, or select another model in Models.',502);
 return content;
}
