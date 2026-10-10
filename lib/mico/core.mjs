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
export function validateReply(raw) {
  const clean=raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
  const obj=JSON.parse(clean);
  if(typeof obj.message!=='string' || typeof obj.done!=='boolean' || !Array.isArray(obj.actions) || obj.actions.length>12) throw new Error('Model response did not match the action format. Try a larger model.');
  const types=['read_file','write_file','edit_file','delete_file','search','list_files','check_project','review_quality'];
  for(const a of obj.actions) {
    if(!types.includes(a.type)) throw new Error('Unsupported agent action.');
    if(a.type.endsWith('_file')) { a.path=safePath(a.path); if(isPrivatePath(a.path)) throw new Error('Secret and dependency files are excluded from agent access.'); }
    if(a.type==='write_file' && (typeof a.content!=='string'||a.content.length>150000)) throw new Error('File content must be text under 150 KB.');
    if(a.type==='edit_file' && (typeof a.find!=='string'||!a.find||a.find.length>50000||typeof a.replace!=='string'||a.replace.length>150000))throw new Error('An edit needs nonempty exact find text and replacement text.');
    if(a.type==='read_file'&&(a.startLine!==undefined||a.endLine!==undefined)&&(!Number.isInteger(a.startLine)||!Number.isInteger(a.endLine)||a.startLine<1||a.endLine<a.startLine||a.endLine-a.startLine>499))throw new Error('Read ranges must include 1-based startLine and endLine, at most 500 lines.');
    if(a.type==='search' && (typeof a.query!=='string'||a.query.length>200)) throw new Error('Invalid search query.');
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
export function checkProject(files) {
  const issues=[];
  for(const [path,content] of Object.entries(files)) {
    if(path.endsWith('.json')) { try{JSON.parse(content)}catch(e){issues.push(path+': '+e.message)} }
    if(path.endsWith('.html')) {
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
