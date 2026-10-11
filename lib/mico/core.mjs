export function safePath(input) {
  if(typeof input !== 'string') throw new Error('A file path is required.');
  const p=input.trim().replaceAll('\\','/').replace(/^\.\//,'');
  if(!p || p.length>180 || p.startsWith('/') || /[\x00-\x1f:]/.test(p) || p.split('/').some(s=>!s||s==='..'||s==='.'||['__proto__','constructor','prototype'].includes(s))) throw new Error('Use a relative workspace path, such as src/app.js.');
  return p;
}
export function isPrivatePath(p) { return /(^|\/)(\.env($|\.)|\.git\/|node_modules\/)|\.(pem|key|p12|pfx)$/i.test(p); }
export function mergeFiles(files, changes) {
  const next={...files};
  for(const [path,content] of Object.entries(changes)) { safePath(path); if(content===null) delete next[path]; else next[path]=content; }
  return next;
}
export function extractJsonFromText(raw) {
  if (typeof raw !== 'string') return '';
  // 1. Remove <think>...</think> tags if present
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (text.startsWith('<think>')) {
    const end = text.indexOf('</think>');
    if (end !== -1) text = text.slice(end + 8).trim();
  }
  // 2. Check if text is direct JSON
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try { JSON.parse(trimmed); return trimmed; } catch {}
  }
  // 3. Check for ```json ... ``` code fence
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    const candidate = codeBlockMatch[1].trim();
    try { JSON.parse(candidate); return candidate; } catch {}
  }
  // 4. Find outermost { and }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1).trim();
    try { JSON.parse(candidate); return candidate; } catch {}
  }
  // Fallback to strip markdown wrapper
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}
export function validateReply(raw) {
  const clean = extractJsonFromText(raw);
  const obj=JSON.parse(clean);
  if(typeof obj.message!=='string' || typeof obj.done!=='boolean' || !Array.isArray(obj.actions) || obj.actions.length>12) throw new Error('Model response did not match the action format. Try a larger model.');
  const types=['read_file','write_file','edit_file','delete_file','search','list_files','check_project','review_quality','publish','git'];
  for(const a of obj.actions) {
    if(!types.includes(a.type)) throw new Error('Unsupported agent action.');
    if(a.type.endsWith('_file')) { a.path=safePath(a.path); if(isPrivatePath(a.path)) throw new Error('Secret and dependency files are excluded from agent access.'); }
    if(a.type==='write_file' && (typeof a.content!=='string'||a.content.length>150000)) throw new Error('File content must be text under 150 KB.');
    if(a.type==='edit_file' && (typeof a.find!=='string'||!a.find||a.find.length>50000||typeof a.replace!=='string'||a.replace.length>150000))throw new Error('An edit needs nonempty exact find text and replacement text.');
    if(a.type==='read_file'&&(a.startLine!==undefined||a.endLine!==undefined)&&(!Number.isInteger(a.startLine)||!Number.isInteger(a.endLine)||a.startLine<1||a.endLine<a.startLine||a.endLine-a.startLine>499))throw new Error('Read ranges must include 1-based startLine and endLine, at most 500 lines.');
    if(a.type==='search' && (typeof a.query!=='string'||a.query.length>200)) throw new Error('Invalid search query.');
    if(a.type==='publish') {
      if(a.target && !['github','vercel','netlify','custom'].includes(a.target)) throw new Error('Unsupported publish target.');
      if(a.repo && (typeof a.repo !== 'string' || a.repo.length > 100)) throw new Error('Invalid repository name.');
    }
    if(a.type==='git') {
      if(a.command && !['status','commit','push','pull','init','log','branch','diff'].includes(a.command)) throw new Error('Unsupported git command.');
      if(a.message && (typeof a.message !== 'string' || a.message.length > 500)) throw new Error('Invalid git commit message.');
    }
  }
  return obj;
}
export function exactEdit(content,find,replace) {
 if(typeof content!=='string')throw new Error('Read an existing file before patching it.');
 if(typeof find!=='string'||!find||typeof replace!=='string')throw new Error('Use exact nonempty find text.');
 const first=content.indexOf(find);
 if(first<0)throw new Error('Find text does not match the current file. Read the relevant lines again.');
 if(content.indexOf(find,first+1)!==-1)throw new Error('Find text is ambiguous. Include more surrounding text so it matches once.');
 const next=content.slice(0,first)+replace+content.slice(first+find.length);
 if(next.length>150000)throw new Error('The resulting file exceeds 150 KB.');
 return next;
}
export function qualityReview(files) {
 const issues=[];
 for(const [path,content] of Object.entries(files)) {
  if(!path.endsWith('.html'))continue;
  if(!/<html\b[^>]*\blang\s*=/i.test(content))issues.push(path+': set the document language for assistive technology.');
  if(!/<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(content))issues.push(path+': add a viewport meta tag for mobile layouts.');
  if(!/<title>[^<]+<\/title>/i.test(content))issues.push(path+': give the page a descriptive title.');
  if([...content.matchAll(/<img\b[^>]*>/gi)].some(([tag])=>! /\balt\s*=/i.test(tag)))issues.push(path+': add alt text to images, or empty alt text for decoration.');
  if(/href\s*=\s*["']#["']/i.test(content))issues.push(path+': replace placeholder links with useful destinations or buttons.');
  for(const [tag] of content.matchAll(/<input\b[^>]*>/gi)) {
   if(/type\s*=\s*["'](?:hidden|submit|button|reset)["']/i.test(tag)||/aria-label(?:ledby)?\s*=/i.test(tag))continue;
   const id=/\bid\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
   const wrapped=content.slice(Math.max(0,content.indexOf(tag)-350),content.indexOf(tag)).lastIndexOf('<label')>content.slice(Math.max(0,content.indexOf(tag)-350),content.indexOf(tag)).lastIndexOf('</label');
   const associated=id&&[...content.matchAll(/<label\b[^>]*for\s*=\s*["']([^"']+)["']/gi)].some(m=>m[1]===id);
   if(!wrapped&&!associated){issues.push(path+': give form controls accessible labels.');break}
  }
 }
 return issues.slice(0,12);
}
// A bounded source check for direct text between explicit head elements.
// This is not an HTML validator: raw text elements, comments and inert
// template content are skipped without interpreting their JavaScript or CSS.
function strayHeadText(content) {
 const tokens=/<!--[\s\S]*?-->|<![^>]*>|<\/?([A-Za-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;
 const raw=new Set(['title','style','script','noscript','noframes']);
 let inHead=false,templates=0,cursor=0,stray='';
 for(let match; (match=tokens.exec(content));) {
  if(inHead&&!templates&&!stray){
   const text=content.slice(cursor,match.index).replace(/&#(?:0*(?:9|10|12|13|32)|x0*(?:9|a|c|d|20));/gi,' ').trim();
   if(text)stray=text.slice(0,80);
  }
  cursor=tokens.lastIndex;
  const name=match[1]?.toLowerCase();if(!name)continue;
  const closing=match[0].startsWith('</');
  if(name==='head'&&!templates){if(closing&&inHead)return stray; if(!closing&&!inHead){inHead=true;stray=''}}
  if(name==='template'){templates=Math.max(0,templates+(closing?-1:1));continue}
  if(inHead&&!templates&&(name==='body'||(name==='html'&&closing)))return '';
  if(!closing&&raw.has(name)){
   const end=new RegExp('</'+name+'\\s*>','gi');end.lastIndex=cursor;
   const found=end.exec(content);if(!found)return '';
   cursor=end.lastIndex;tokens.lastIndex=cursor;
  }
 }
 return '';
}
export function checkProject(files) {
  const issues=[];
  for(const [path,content] of Object.entries(files)) {
    if(path.endsWith('.json')) { try{JSON.parse(content)}catch(e){issues.push(path+': '+e.message)} }
    if(path.endsWith('.html')) {
      const stray=strayHeadText(content);
      if(stray)issues.push(path+': stray text between <head> elements: '+JSON.stringify(stray)+'. Read the current staged file and remove this stray text, keeping title, style, script and comment content intact.');
      for(const match of content.matchAll(/(?:src|href)=["']([^"'#?]+)["']/g)) {
        const target=match[1]; if(/^(https?:|data:|blob:|\/\/|mailto:|tel:)/.test(target)) continue;
        const resolved=target.startsWith('/')?target.slice(1):path.slice(0,path.lastIndexOf('/')+1)+target.replace(/^\.\//,'');
        if(!Object.hasOwn(files,resolved)) issues.push(path+': missing local resource '+target);
      }
    }
  }
  if(!Object.keys(files).some(p=>p.endsWith('.html'))) issues.push('Add an HTML entry point to use browser preview.');
  return issues;
}
export function diffLines(before,after) {
  const a=(before??'').split('\n'), b=(after??'').split('\n');
  let first=0; while(first<Math.min(a.length,b.length)&&a[first]===b[first])first++;
  let endA=a.length,endB=b.length; while(endA>first&&endB>first&&a[endA-1]===b[endB-1]){endA--;endB--;}
  return [...a.slice(Math.max(0,first-3),first).map(text=>({kind:'context',text})),...a.slice(first,endA).map(text=>({kind:'remove',text})),...b.slice(first,endB).map(text=>({kind:'add',text})),...b.slice(endB,endB+3).map(text=>({kind:'context',text}))];
}
