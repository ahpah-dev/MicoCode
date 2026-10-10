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
  const types=['read_file','write_file','delete_file','search','list_files','check_project'];
  for(const a of obj.actions) {
    if(!types.includes(a.type)) throw new Error('Unsupported agent action.');
    if(a.type.endsWith('_file')) { safePath(a.path); if(isPrivatePath(a.path)) throw new Error('Secret and dependency files are excluded from agent access.'); }
    if(a.type==='write_file' && (typeof a.content!=='string'||a.content.length>150000)) throw new Error('File content must be text under 150 KB.');
    if(a.type==='search' && (typeof a.query!=='string'||a.query.length>200)) throw new Error('Invalid search query.');
  }
  return obj;
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
