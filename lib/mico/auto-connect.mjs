// Picks a coding model that is both strong and demonstrably able to follow
// MicoCode's JSON action protocol, instead of trusting whatever is listed first.
import {validateReply} from './core.mjs';
import {normalizeEndpoint} from './providers.mjs';

const NON_CHAT=/(^|[\/-])(asr|tts|stt|whisper|parakeet|embed|embedding|rerank|moderation|image|vision-only|dall-e|sdxl|flux)([\/-]|$)|-asr-|ctc/i;
// Families that are no longer worth choosing for coding. They stay selectable when
// they are all that is on offer, but they sink below every current model, so the
// workspace can never quietly settle on a two-generation-old one.
const OBSOLETE=/gpt-4o|gpt-4\.1|gpt-4-turbo|\bgpt-4\b|gpt-3\.5|\bo1(-|$)|claude-2|claude-3|gemini-1\.|gemini-2\.0|gemini-2\.5|llama-?2|llama-?3|mixtral|phi-3|qwen2|command-r\b|deepseek-v2/i;
// Higher is stronger for multi-step coding with strict JSON output.
const TIERS=[
  [100,/claude-(opus|sonnet)-?[45]|claude-opus|claude-sonnet|gpt-5|gemini-3.*(pro|flash)|\bo3\b/i],
  [92,/kimi-k3|glm-5\.3(?!-flash)|deepseek-v4-pro|deepseek-v4\.1(?!-flash)|qwen3\.[5678].*(coder|max|plus)|qwen3-coder|minimax-m3|nemotron-3-ultra|kat-coder-pro/i],
  [84,/kimi-k2\.[67]|glm-5\.2|deepseek-v4|deepseek-reasoner|deepseek-chat|minimax-m2\.7|glm-5|nemotron-3-super|devstral|codestral|kilo-auto\/frontier/i],
  [70,/kilo-auto|qwen3|flash|nemotron|llama-?4|mistral|coder/i],
  [40,/gemma|phi|small|mini|tiny|lite|:1b|:3b|:4b|:7b|:8b/i],
];
export function codingRank(id) {
  const name=String(id||'');
  if(!name||NON_CHAT.test(name))return -1;
  if(OBSOLETE.test(name))return 8;
  let score=50;
  for(const [value,pattern] of TIERS)if(pattern.test(name)){score=value;break}
  if(/:free\b/i.test(name))score-=6;
  if(/-flash|-mini|-lite/i.test(name))score-=4;
  return score;
}
// Within one tier the newer release wins: Gemini 3.8 Flash must beat 3.7 rather
// than lose to it on alphabetical order. Only dotted versions count, so a parameter
// count like the 120b in gpt-oss-120b is never mistaken for a version.
export function modelVersion(id){
 let best=0;
 for(const found of String(id||'').matchAll(/(\d+\.\d+)/g)){const value=Number(found[1]);if(value>best)best=value}
 return best;
}
// The family a model id belongs to, so releases are only compared like for like.
export function modelFamily(id){
 const tail=String(id||'').split('/').pop()||'';
 const found=/^[a-z]+/i.exec(tail);
 return found?found[0].toLowerCase():'';
}
export function rankCodingModels(models) {
  const ids=[...new Set((models||[]).map(m=>typeof m==='string'?m:m?.id).filter(id=>typeof id==='string'&&id))];
  const context=new Map((models||[]).filter(m=>m&&typeof m==='object').map(m=>[m.id,Number(m.contextLength)||0]));
  return ids.map(id=>({id,score:codingRank(id)})).filter(m=>m.score>=0)
    .sort((a,b)=>{
  const byScore=b.score-a.score;if(byScore)return byScore;
  const family=modelFamily(a.id);
  if(family&&family===modelFamily(b.id)){const byVersion=modelVersion(b.id)-modelVersion(a.id);if(byVersion)return byVersion}
  const byContext=(context.get(b.id)||0)-(context.get(a.id)||0);if(byContext)return byContext;
  return a.id.localeCompare(b.id);
}).map(m=>m.id);
}
const PROBE_SYSTEM='You are a coding agent. Respond ONLY with one JSON object of the form {"message":"short note","actions":[{"type":"list_files"}],"done":false}. No other text.';
export async function probeModel({base,key,model,signal,timeoutMs=25000,fetchImpl=fetch}) {
  const started=Date.now();
  try{
    const response=await fetchImpl(normalizeEndpoint(base)+'/chat/completions',{
      method:'POST',redirect:'error',
      headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},
      body:JSON.stringify({model,stream:false,temperature:0,max_tokens:1200,messages:[{role:'system',content:PROBE_SYSTEM},{role:'user',content:'Start by listing the project files.'}]}),
      signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs),
    });
    if(!response.ok)return {ok:false,model,status:response.status,ms:Date.now()-started};
    const data=await response.json().catch(()=>null);
    const text=data?.choices?.[0]?.message?.content;
    if(typeof text!=='string')return {ok:false,model,ms:Date.now()-started};
    const reply=validateReply(text);
    return {ok:reply.actions.length>0&&reply.actions[0].type==='list_files',model,ms:Date.now()-started};
  }catch{return {ok:false,model,ms:Date.now()-started}}
}
// Probes the strongest candidates in small parallel batches and returns the
// highest-ranked model that answered in the right format, or null.
export async function pickWorkingCodingModel({base,key,models,signal,limit=24,concurrency=6,probe=probeModel,onProgress=_msg=>{}}) {
  const candidates=rankCodingModels(models).slice(0,limit);
  const results=new Map();
  for(let i=0;i<candidates.length;i+=concurrency){
    const batch=candidates.slice(i,i+concurrency);
    await Promise.all(batch.map(async model=>{onProgress('Testing '+model);results.set(model,await probe({base,key,model,signal}))}));
    const winner=candidates.slice(0,i+concurrency).find(m=>results.get(m)?.ok);
    // A passing model in an earlier batch outranks everything that follows.
    if(winner)return winner;
    if(signal?.aborted)return null;
  }
  return null;
}
export async function discoverLocalNineKey(fetchImpl=fetch) {
  try{
    if(typeof window!=='undefined'&&window.micoDesktop?.existingNineKey){
      const found=await window.micoDesktop.existingNineKey().catch(()=>null);
      if(found?.key)return found;
    }
  }catch{}
  try{
    const r=await fetchImpl('http://127.0.0.1:20128/api/keys',{redirect:'error',signal:AbortSignal.timeout(2000)});
    if(r.ok){
      const d=await r.json().catch(()=>({}));
      const usable=(d.keys||[]).filter(k=>k&&typeof k.key==='string'&&/^sk-[\w-]{8,}$/.test(k.key)&&k.isActive!==false&&!k.accessRestricted);
      const pick=usable.find(k=>k.name==='MicoCode desktop')||usable.find(k=>k.name==='Default Key')||usable[0];
      if(pick)return {key:pick.key,name:String(pick.name||'API key').slice(0,60)};
    }
    const created=await fetchImpl('http://127.0.0.1:20128/api/keys',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'MicoCode desktop'}),signal:AbortSignal.timeout(2000)});
    if(created.ok){
      const d=await created.json().catch(()=>({}));
      if(typeof d.key==='string'&&/^sk-[\w-]{8,}$/.test(d.key))return {key:d.key,name:'MicoCode desktop'};
    }
  }catch{}
  return null;
}

