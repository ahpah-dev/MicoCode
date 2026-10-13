import {checkProject,exactEdit,isPrivatePath,mergeFiles,qualityReview,validateReply} from './core.mjs';
import {listProxyModels,normalizeEndpoint,proxyPresets,readCredential} from './providers.mjs';
import {getFallbackCandidates,isRecoverableProviderError} from './fallback.ts';
import {rankCodingModels} from './auto-connect.mjs';
import {resilientRequest} from './resilience.mjs';
import {readModelText} from './response-reader.mjs';
import {actionSchema} from './action-schema.mjs';
export {actionSchema} from './action-schema.mjs';
import {executePublish} from './plugins.ts';
import type {AgentReply,Changes,Config,Files,Project} from './types';
type Chat = {role:'system'|'user'|'assistant';content:string;reasoning_content?:string};
export const systemPrompt = `You are Mico, the coding agent in MicoCode. Help create polished, accessible HTML/CSS/JavaScript websites. This workspace previews browser files only, with no Node, npm, shell, or backend. Use relative files and vanilla JS. Do not claim you ran a command or test you did not run. Never fetch secrets or instruct quota bypasses.
Respond ONLY with a JSON object: {"message":"a concise progress note or answer","actions":[...],"done":false}.\nSet "done":true the moment the request is answered or nothing needs changing. Greetings, questions and ordinary conversation need no actions and are finished immediately: {"message":"Hi! What would you like to build?","actions":[],"done":true}.\nNever say you are waiting for instructions while leaving "done":false — either take an action this turn or finish with "done":true.\nNever repeat an action that already returned the same result — repeating it cannot change anything. If you are stuck, finish with "done":true and say in one sentence what is blocking you.\nWhen you finish, say in one line what you changed.
Available actions: {"type":"list_files"}, {"type":"read_file","path":"index.html"}, {"type":"read_file","path":"index.html","startLine":1,"endLine":80}, {"type":"search","query":"text"}, {"type":"edit_file","path":"index.html","find":"exact unique text that was read","replace":"replacement text"}, {"type":"write_file","path":"styles.css","content":"complete file contents"}, {"type":"delete_file","path":"file.txt"}, {"type":"check_project"}, {"type":"review_quality"}, {"type":"publish","target":"github"|"vercel"|"netlify"|"custom","repo":"repo-name","message":"commit message"}, {"type":"git","command":"status"|"commit"|"push"|"pull"|"init"|"log"|"branch"|"diff","message":"commit message"}.
Read before changing. Use edit_file for existing content. Never delete and recreate a file to modify it. Preserve everything outside the requested change. For example, after reading <title>Old</title>, change its text with {"type":"edit_file","path":"index.html","find":"<title>Old</title>","replace":"<title>New</title>"}. Replacement text is literal file content: never include JSON punctuation in it. Match once and include surrounding text. Large files can be read by line ranges; do not rewrite a partially read file. Write complete files, never placeholders or ellipses. Use at most one action per reply. check_project checks JSON and local HTML resources. review_quality checks basic HTML accessibility and mobile metadata. Use publish when asked to deploy or push to GitHub/Vercel/Netlify. Use git for native Git operations (status, commit, push, pull, log, init) in local folders. Changes are staged for review. Check work before setting done:true. Be concise.`;
const polishPrompt='\nPOLISHED MODE: Make focused, maintainable changes. Preserve working features and match the existing design. For new interfaces use cohesive spacing, readable type, responsive layouts, semantic HTML, accessible labels, visible keyboard focus, and useful loading, error and empty states where relevant. Wire up every control you add. Avoid placeholder links and fake data claims. Run check_project and review_quality before finishing; report any runtime checks still needed.';
let engine:import('@mlc-ai/web-llm').MLCEngineInterface|undefined;
let loadedModel='';
export async function loadBrowserModel(size:Config['browserSize'],progress:(s:string)=>void) {
 const gpu=(navigator as unknown as {gpu?:{requestAdapter:()=>Promise<{features:Set<string>}|null>}}).gpu;
 if(!gpu) throw new Error('WebGPU is unavailable here. Open MicoCode in a recent Chrome or Edge, or connect Ollama / OpenRouter.');
 const adapter=await gpu.requestAdapter();if(!adapter)throw new Error('No compatible GPU was found. Connect Ollama or OpenRouter instead.');
 const mod=await import('@mlc-ai/web-llm');
 const precision=adapter.features.has('shader-f16')?'q4f16_1':'q4f32_1';
 const model=size==='8B'?`Qwen3-8B-${precision}-MLC`:`Qwen3.5-9B-${precision}-MLC`;
 if(!mod.prebuiltAppConfig.model_list.some(m=>m.model_id===model))throw new Error('This model is not supported by the installed WebLLM version.');
 if(engine&&loadedModel===model)return;
 if(engine)await engine.unload();
 engine=undefined;loadedModel='';
 const worker=new Worker(new URL('./llm.worker.ts',import.meta.url),{type:'module'});
 try{engine=await mod.CreateWebWorkerMLCEngine(worker,model,{initProgressCallback:p=>progress(p.text)},{context_window_size:8192});loadedModel=model;}catch(e){worker.terminate();throw e}
}
export function browserReady(size:Config['browserSize']) { return !!engine && loadedModel.includes(size==='8B'?'Qwen3-8B':'Qwen3.5-9B'); }
// Context metadata from the selected router model is in tokens; the agent
// budgets character slices conservatively and leaves room for prompt overhead.
export function modelContextBudget(contextLength:number|undefined,fallback:number) {
 if(!Number.isFinite(contextLength)||!contextLength)return fallback;
 return Math.min(240000,Math.max(12000,Math.floor(contextLength*1.6)));
}
export function stopBrowser() {engine?.interruptGenerate();}
async function executeSingleProvider(messages:Chat[],config:Config,key:string,signal:AbortSignal,onToken:(t:string)=>void,onStatus:(t:string)=>void=()=>{},onReasoning:(t:string)=>void=()=>{}) {
 if(config.provider==='browser') {
   if(!browserReady(config.browserSize)||!engine)throw new Error('Load a browser model in Connections first.');
   const stream=await engine.chat.completions.create({messages,stream:true,temperature:config.temperature,max_tokens:1800,response_format:{type:'json_object',schema:JSON.stringify(actionSchema)}});
   let content='';for await(const part of stream){if(signal.aborted){engine.interruptGenerate();throw new DOMException('Stopped','AbortError')};content+=part.choices[0]?.delta.content||'';onToken(content)}return content;
 }
 const local=config.provider==='ollama';
 const horde=config.provider==='proxy'&&config.proxyPreset==='horde';
  const opencode=config.provider==='proxy'&&config.proxyPreset==='opencode';
  const nim=config.provider==='proxy'&&config.proxyPreset==='nim';
  const aistudio=config.provider==='proxy'&&config.proxyPreset==='aistudio';
  const aihubmix=config.provider==='proxy'&&config.proxyPreset==='aihubmix';
  const custom=config.provider==='proxy'&&!horde&&!opencode&&!nim&&!aistudio&&!aihubmix;
  const managedLocal=config.managed&&config.routerEngine==='local'&&(local||config.freeModels.includes(config.model));
 if(managedLocal)onStatus('Generating with your local model. The first prompt may take longer while it loads; Stop cancels the request.');
 if(opencode&&!key)throw new Error('Add your own OpenCode Zen key in Models before sending a prompt.');
 if(aihubmix&&!key&&!readCredential(config))throw new Error('Add your AIHubMix API key in Connections before sending a prompt.');
  const url=local?config.ollamaUrl.replace(/\/$/,'')+'/api/chat':horde?'/api/horde':opencode?'/api/opencode':nim?'/api/nim':aistudio?'/api/aistudio':aihubmix?'/api/aihubmix':custom?normalizeEndpoint(config.proxyUrl)+'/chat/completions':'/api/ai';
 // The managed local route shares the standard output window. A narrower one
  // truncated any write_file carrying a complete page and reported an output
  // limit instead of an edit.
   const body=local?{model:config.model,messages,stream:false,think:false,format:actionSchema,options:{temperature:config.temperature,num_predict:4096}}:horde||opencode||nim||aistudio||aihubmix?{action:'complete',model:config.model,messages,temperature:config.temperature}:custom?{model:config.model,messages,temperature:config.temperature,max_tokens:4096,stream:false}:{model:config.model,messages,temperature:config.temperature,freeFallback:config.freeFallback};
  const effectiveKey=key||(!local&&!horde&&config.provider==='proxy'?readCredential(config):'');
   const operation=()=>fetch(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(custom&&config.proxyPreset==='freellmapi'?{'X-FreeLLM-Task-Type':'code'}:{}),...(!local&&!horde&&effectiveKey?{Authorization:`Bearer ${effectiveKey}`}:{})},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(managedLocal?620000:nim||aistudio||aihubmix?190000:130000)])});
  // 9Router quotas are enforced per provider route; exhausting OpenCode must
  // not cool down unrelated providers exposed by the same router.
  const routerModel=config.model.trim(),slash=routerModel.indexOf('/');
  const routerProvider=slash>0?routerModel.slice(0,slash):routerModel;
  const routerScope=custom&&config.proxyPreset==='9router'?':'+routerProvider:'';
  // Other connections keep a shared cooldown so model switching cannot reset provider limits.
   const response=await resilientRequest(operation,{scope:config.provider+':'+(opencode?'opencode':nim?'nim':aistudio?'aistudio':aihubmix?'aihubmix':horde?'horde':custom?normalizeEndpoint(config.proxyUrl)+routerScope:local?config.ollamaUrl:''),signal,enabled:config.resilience,paceMs:local?0:config.provider==='openrouter'?3200:1500,onStatus});
  if(custom&&config.proxyPreset==='freellmapi'&&response.ok){const route=response.headers.get('x-routed-via');if(route)onStatus('FreeLLMAPI routed this turn through '+route.slice(0,160)+(Number(response.headers.get('x-fallback-attempts'))>0?' after provider failover.':'.'))}
  const content=await readModelText(response,{local,signal,onReasoning});
 onToken(content);return content;
}

export async function complete(messages:Chat[],config:Config,key:string,signal:AbortSignal,onToken:(t:string)=>void,onStatus:(t:string)=>void=()=>{},onReasoning:(t:string)=>void=()=>{}) {
 try {
  return await executeSingleProvider(messages,config,key,signal,onToken,onStatus,onReasoning);
 } catch(error) {
  if(signal.aborted||config.freeFallback===false||!isRecoverableProviderError(error)) {
   throw error;
  }
  const candidates=getFallbackCandidates(config,key);
  if(!candidates.length)throw error;
  const primaryName=config.provider==='proxy'?(proxyPresets.find(p=>p.id===config.proxyPreset)?.name||config.proxyPreset):config.provider;
  let lastError:unknown=error;
  for(const candidate of candidates) {
   if(signal.aborted)throw signal.reason||new DOMException('Stopped','AbortError');
   let target=candidate;
   if(!target.config.model) {
    // The user never picked a model for this provider, so ask it what it offers
    // right now and take the strongest current one. Falling back to a hardcoded
    // name here is how a workspace ends up on a model two generations old.
    try {
     const available=await listProxyModels(target.config,target.key,signal);
     const best=rankCodingModels(available)[0];
     if(!best)continue;
     target={...target,config:{...target.config,model:best}};
    } catch { continue; }
   }
   try {
    const errorMsg=(error as Error)?.message?.slice(0,100)||'Rate limit or service error';
    onStatus(`⚡ ${primaryName} reached a limit (${errorMsg}). Instant fallback to ${target.name} (${target.config.model})…`);
    return await executeSingleProvider(messages,target.config,target.key,signal,onToken,onStatus,onReasoning);
   } catch(fallbackError) {
    if(signal.aborted)throw fallbackError;
    lastError=fallbackError;
    if(!isRecoverableProviderError(fallbackError)) {
     throw fallbackError;
    }
   }
  }
  throw lastError;
 }
}
export async function runAgent(args:{project:Project;prompt:string;mode:'agent'|'plan';config:Config;key:string;signal:AbortSignal;onMessage:(text:string,role:'assistant'|'activity')=>void;onChanges:(c:Changes)=>void;onToken:(t:string)=>void}) {
 const {project,prompt,mode,config,key,signal,onMessage,onChanges,onToken}=args;
 let changes:Changes={...project.changes};
 const initialFiles=mergeFiles(project.files,changes) as Files;
 const initialIssues=new Set([...checkProject(initialFiles),...(config.quality==='polished'?qualityReview(initialFiles):[])]);
 let discoveredContext:number|undefined;
   if(config.provider==='proxy') {
    onMessage('Verifying the selected route…','activity');
    let available:{id:string;contextLength?:number}[]=[];
    try{available=await listProxyModels(config,key,AbortSignal.any([signal,AbortSignal.timeout(20000)]))}
    catch(e){if(signal.aborted)throw e;onMessage('Model discovery is unavailable: '+(e as Error).message+' Trying the selected model directly; your router will enforce its access rules.','activity')}
    const selected=available.find((m:{id:string})=>m.id===config.model);
    if(!selected&&available.length)onMessage('This model ID is not in the catalogue. Trying it directly; your router may reject unavailable or unauthorized models.','activity');
    discoveredContext=selected?.contextLength;
   }
 const contextFallback=config.provider==='browser'?6500:config.provider==='proxy'&&(config.proxyPreset==='horde'||config.managed)?10000:50000;
 const contextLimit=modelContextBudget(discoveredContext,contextFallback);
 const prior=project.messages.filter(m=>m.role==='user'||m.role==='assistant').slice(-4).map(m=>`${m.role}: ${m.text}`).join('\n').slice(-1800);
 const instruction=systemPrompt+(config.quality==='polished'?polishPrompt:'')+(mode==='plan'?'\nPLAN MODE: Do not write, edit or delete files. Inspect files and explain your plan.':'');
 let observation='';let invalid=0;let polishPass=false;const fullyRead=new Set<string>();const fragments=new Map<string,string[]>();
 const conversation:Chat[]=[{role:'system',content:instruction}];
 const stepLimit = config.maxSteps && config.maxSteps > 0 ? config.maxSteps : 100;
 // A step that returns the identical result cannot make progress, so the next
 // attempt returns the same thing again. Track it and stop instead of spending
 // the remaining steps on a loop.
 let repeats=0,lastSignature='';
 for(let step=0;step<stepLimit;step++) {
   if(signal.aborted)throw new DOMException('Stopped','AbortError');
   const files=mergeFiles(project.files,changes) as Files;
   const manifest=Object.keys(files).filter(p=>!isPrivatePath(p));
   const request=`Project: ${project.name}\nFiles: ${manifest.join(', ')}\nRecent chat: ${prior}\nUser request: ${prompt}\nMode: ${mode}. Step ${step+1}${config.maxSteps > 0 ? ` of ${config.maxSteps}` : ''}. Already staged: ${Object.keys(changes).join(', ')||'none'}.\nLatest tool results:\n${observation.slice(-contextLimit)}\nReturn the next JSON action object.`;
   onToken('');onMessage(`Step ${step+1}${config.maxSteps > 0 ? `/${config.maxSteps}` : ''} · Thinking with ${config.provider==='browser'?(config.browserSize==='8B'?'Qwen 3 8B':'Qwen 3.5 9B'):config.model}`,'activity');
   if(step===0)conversation.push({role:'user',content:request});
   else conversation.push({role:'user',content:'Tool execution results (already completed):\n'+observation.slice(-contextLimit)+'\nContinue toward the original task. If a file was just read, use its content above to write the edit now; do not read it again. Return the next JSON action object.'});
   const budget=contextLimit+(config.provider==='browser'?4000:8000);
    const conversationSize=()=>conversation.reduce((n,m)=>n+m.content.length+(m.reasoning_content?.length||0),0);
    if((config.compactContext||config.provider==='browser')&&conversation.length>4&&conversationSize()>budget){const before=conversationSize();conversation.splice(2,conversation.length-4);onMessage(`Context optimized · removed ${Math.round((before-conversationSize())/4).toLocaleString()} estimated tokens of older tool results; keeping your task and latest read.`,'activity')}
    let raw:string,reasoningContent='';
    try{raw=await complete(conversation,config,key,signal,onToken,text=>onMessage(text,'activity'),text=>{reasoningContent=text})}
    catch(e){
     if(signal.aborted)throw e;
     // A truncated reply is never applied, but it is repairable: ask the model
     // for a smaller step instead of discarding the whole run.
     if((e as {status?:number}).status!==422)throw e;
     if(++invalid>2)throw new Error('The model repeatedly exceeded its output limit. Ask for one smaller edit, or select a model with a larger output window.');
     onMessage('The reply hit the model output limit before it finished. Asking for a smaller step.','activity');
     observation='Your last reply was cut off at the output limit before its JSON closed, so it was discarded. Reply again with one short JSON object: keep the message to one sentence and stage the smallest complete file or edit that fits. Do not repeat work that is already staged.';
     continue
    }
    // Echo OpenCode reasoning in the protocol field required by some upstreams;
    // never merge it into the visible JSON action or expose it as generated text.
    conversation.push({role:'assistant',content:raw,...(config.provider==='proxy'&&config.proxyPreset==='9router'&&reasoningContent?{reasoning_content:reasoningContent}:{})});
   if(signal.aborted)throw new DOMException('Stopped','AbortError');
   let reply:AgentReply;
   try{reply=validateReply(raw);invalid=0}catch(e){if(++invalid>4)throw new Error('This model could not follow the action format after several repairs. Pick a stronger coding model in Models (Auto-Configure finds one); staged work is preserved.');onMessage('The response was incomplete or invalid. Asking the model to repair it.','activity');observation=`Your last output could not be parsed: ${String(e)}. It started with: ${JSON.stringify(String(raw).trim().slice(0,160))}. Reply with ONLY one JSON object and no other text, for example {"message":"Reading the page","actions":[{"type":"read_file","path":"index.html"}],"done":false}. Prefer one small exact edit per response, keeping output short.`;continue}
   if(reply.message)onMessage(reply.message,'assistant');
   const results:string[]=[];let failed=false;const delivered:string[]=[];
   for(const action of reply.actions) {
     if(signal.aborted)throw new DOMException('Stopped','AbortError');
     const current=mergeFiles(project.files,changes) as Files;
     const path=action.path!;
     if(['write_file','edit_file','delete_file'].includes(action.type)&&mode==='plan'){results.push('Edits are disabled in plan mode.');failed=true;continue}
     if(action.type==='read_file'){
      const content=current[path];const partial=action.startLine!==undefined;
      const read=partial?content?.split('\n').slice(action.startLine!-1,action.endLine).join('\n'):content;
      if(read!==undefined&&read.length>contextLimit){failed=true;results.push('Cannot safely read '+path+': this exceeds the context budget. Use a smaller startLine/endLine range and edit_file, never overwrite unread content.')}
      else {if(content!==undefined){if(!partial)fullyRead.add(path);fragments.set(path,[...(fragments.get(path)||[]).slice(-9),read!]);delivered.push(path)}results.push(`FILE ${path}${partial?' · lines '+action.startLine+'–'+action.endLine:''}:\n${read??'File does not exist.'}`)}
     }
     if(action.type==='list_files')results.push(Object.keys(current).filter(p=>!isPrivatePath(p)).join('\n'));
     if(action.type==='search')results.push(Object.entries(current).filter(([p])=>!isPrivatePath(p)).flatMap(([p,c])=>c.split('\n').map((line,i)=>line.toLowerCase().includes(action.query!.toLowerCase())?`${p}:${i+1}: ${line}`:'').filter(Boolean)).slice(0,35).join('\n')||'No matches.');
     if(action.type==='write_file'){if(path in current&&!fullyRead.has(path)){failed=true;results.push('Cannot overwrite '+path+' before reading its full contents. Use read_file first, or an exact edit_file patch after reading a range.');continue}if(Object.keys(current).length>=150 && !(path in current))throw new Error('Workspace is limited to 150 files.');changes[path]=action.content!;results.push('Staged '+path);onChanges({...changes})}
     if(action.type==='edit_file'){
      if(!fragments.get(path)?.some(text=>text.includes(action.find!))){failed=true;results.push('Read the exact text you want to edit in '+path+' first.');continue}
      try{changes[path]=exactEdit(current[path],action.find!,action.replace!);results.push('Staged exact edit of '+path);onChanges({...changes})}catch(e){failed=true;results.push((e as Error).message)}
     }
     if(action.type==='delete_file'){if(!fullyRead.has(path)){failed=true;results.push('Read '+path+' before proposing its deletion.');continue}changes[path]=null;results.push('Staged deletion of '+path);onChanges({...changes})}
     if(action.type==='check_project'){const issues=checkProject(current);results.push(issues.length?issues.join('\n'):'JSON and local HTML resource checks passed. Runtime testing still requires Preview.')}
     if(action.type==='review_quality'){const issues=qualityReview(current);results.push(issues.length?issues.join('\n'):'Basic HTML quality checks passed. Manually check responsive layout, focus, contrast and interaction in Preview.')}
     if(action.type==='publish'){
      const target=action.target||'github';
      onMessage(`Publishing project to ${target}…`,'activity');
      const pubRes=await executePublish({target,files:current,projectName:project.name,repo:action.repo,message:action.message});
      if(pubRes.success){results.push(`Successfully published to ${target}! URL: ${pubRes.url}`);onMessage(`Published to ${target}! ${pubRes.url}`,'activity')}
      else{failed=true;results.push(`Publish to ${target} failed: ${pubRes.message}`);onMessage(pubRes.message,'activity')}
     }
     if(action.type==='git'){
      const cmd=action.command||'status';
      onMessage(`Running git ${cmd}…`,'activity');
      const desktop=typeof window!=='undefined'?window.micoDesktop:undefined;
      if(desktop?.git&&project.sourceFolder){
       try{
        if(cmd==='status'){
         const res=await desktop.git.status(project.sourceFolder);
         const summary=res.isRepo?`Branch: ${res.branch}. ${res.clean?'Working tree clean.':`Modified: ${res.modified.length}, Staged: ${res.staged.length}, Untracked: ${res.untracked.length}`}`:'Not a git repository.';
         results.push(`Git status:\n${summary}`);onMessage(`Git status: ${summary}`,'activity');
        }else if(cmd==='commit'){
         const res=await desktop.git.commit(project.sourceFolder,action.message||'Update from MicoCode');
         results.push(`Git commit successful:\n${res.output}`);onMessage(`Git commit: ${action.message||'Update from MicoCode'}`,'activity');
        }else if(cmd==='push'){
         const res=await desktop.git.push(project.sourceFolder);
         results.push(`Git push output:\n${res.output}`);onMessage('Git push complete.','activity');
        }else if(cmd==='pull'){
         const res=await desktop.git.pull(project.sourceFolder);
         results.push(`Git pull output:\n${res.output}`);onMessage('Git pull complete.','activity');
        }else if(cmd==='init'){
         await desktop.git.init(project.sourceFolder);
         results.push('Git repository initialized.');onMessage('Git repository initialized.','activity');
        }else if(cmd==='log'){
         const logs=await desktop.git.log(project.sourceFolder,5);
         const list=logs.map(l=>`${l.shortHash} - ${l.message} (${l.author})`).join('\n');
         results.push(`Recent git commits:\n${list||'No commits yet.'}`);onMessage('Loaded git log.','activity');
        }else if(cmd==='diff'){
         const diff=await desktop.git.diff(project.sourceFolder);
         results.push(`Git diff:\n${diff||'No changes.'}`);onMessage('Checked git diff.','activity');
        }else if(cmd==='branch'){
         const b=await desktop.git.branch(project.sourceFolder);
         results.push(`Git branches:\nCurrent: ${b.current}\nAll: ${b.branches.join(', ')}`);onMessage(`Current branch: ${b.current}`,'activity');
        }
       }catch(e){failed=true;results.push(`Git ${cmd} failed: ${(e as Error).message}`);onMessage(`Git ${cmd} failed: ${(e as Error).message}`,'activity')}
      }else{
       results.push(`Native Git commands require an opened folder in the MicoCode desktop app. In the browser, you can publish directly to GitHub using the Plugins dialog or publish action.`);
       onMessage(`Git ${cmd} requires desktop folder mode.`,'activity');
      }
     }
     onMessage(`${action.type.replaceAll('_',' ')}${path?' · '+path:action.query?' · '+action.query:action.target?' · '+action.target:action.command?' · '+action.command:''}`,'activity');
   }
   observation=results.join('\n\n');if(observation.length>contextLimit){for(const path of delivered){fullyRead.delete(path);fragments.delete(path)}failed=true;observation='Tool results exceeded the context budget. File reads were withheld. Read one smaller range per step; use exact edits and preserve unread content.'}
   // A turn that took no action cannot change anything, so looping only repeats the
   // same sentence until the step limit. A model that answers and forgets to set
   // "done" — which every chatty reply does — finishes here instead.
   if(!reply.done&&!failed&&!results.length){onToken('');return changes}
   // Identical actions with an identical result cannot progress by repeating.
   const signature=JSON.stringify(reply.actions)+"\u0000"+observation;
   repeats=signature===lastSignature?repeats+1:0;lastSignature=signature;
   if(!reply.done&&repeats>=2){
    onMessage('Stopped: the same step returned an identical result three times, so repeating it cannot change anything. '+(Object.keys(changes).length?'Your staged changes are kept.':'Nothing was staged yet.')+' Tell Mico what to do differently, or pick a stronger model in Models.','assistant');
    onToken('');return changes
   }
   if(!reply.done&&repeats===1){
    observation+="\nYou just repeated an action that returned exactly the same result as before. Repeating it will not help. Take a different action, or finish with \"done\":true and one sentence saying what is blocking you.";
    continue
   }
   if(reply.done&&!failed){
    if(mode==='agent'&&Object.keys(changes).length){const merged=mergeFiles(project.files,changes) as Files;const issues=[...checkProject(merged),...(config.quality==='polished'?qualityReview(merged):[])];
     const introduced=issues.filter(issue=>!initialIssues.has(issue));
     if(introduced.length&&config.quality==='polished'&&!polishPass&&step+1<stepLimit){polishPass=true;observation+='\nNew issues introduced by this run:\n'+introduced.join('\n')+'\nFix only these new issues with focused edits before finishing. Preserve unrelated files and preexisting warnings.';onMessage('Polish pass · checking issues introduced by this run.','activity');continue}
     onMessage(issues.length?'Static review needs attention:\n'+issues.join('\n'):'Static review passed. Check layout and interaction in Preview before applying.','activity');
    }onToken('');return changes
   }
 }
 onMessage(config.maxSteps > 0
  ? `The step limit (${config.maxSteps} steps) was reached before the task finished. You can change this to "Until finished" in Settings, or reply to continue.`
  : 'The maximum safety limit (100 steps) was reached. Review the staged work, then send a follow-up to continue.', 'assistant');onToken('');return changes;
}
