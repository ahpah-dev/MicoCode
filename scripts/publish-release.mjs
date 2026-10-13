import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Never replace a published asset. Check source and upload digests before publishing.
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const tag=`v${version}`,sha=git('rev-parse','HEAD');
const directory=path.resolve(process.env.MICO_RELEASE_DIR||'release');
if(git('status','--porcelain'))throw Error('Commit source changes before publishing.');
if(git('rev-parse',`${tag}^{commit}`)!==sha)throw Error('Release tag must point to HEAD.');
if(!git('ls-remote','origin',`refs/tags/${tag}`).startsWith(sha))throw Error('Push the release tag first.');
const notes=fs.readFileSync(`release-notes/${tag}.md`,'utf8');
const sums=fs.readFileSync(path.join(directory,'SHA256SUMS.txt'),'utf8').trim();
const digest=data=>createHash('sha256').update(data).digest('hex');
const assets=sums.split(/\r?\n/).map(line=>{
 const match=/^([a-f0-9]{64}) [ *]([^/\\]+)$/.exec(line);
 if(!match)throw Error('Invalid checksum entry.');
 const [,hash,name]=match;
 if(!name.includes(version))throw Error('Asset version does not match package.json.');
 const data=fs.readFileSync(path.join(directory,name));
 if(digest(data)!==hash)throw Error(`Checksum mismatch: ${name}`);
 return {name,data,hash,type:name.endsWith('.zip')?'application/zip':'application/vnd.microsoft.portable-executable'};
});
if(!assets.length)throw Error('No application downloads found.');
const data=Buffer.from(sums+'\n');
assets.push({name:'SHA256SUMS.txt',data,hash:digest(data),type:'text/plain'});
if(process.argv.includes('--dry-run')){
 console.log(JSON.stringify({tag,sha,assets:assets.map(({name,data,hash})=>({name,size:data.length,sha256:hash}))},null,2));
 process.exit(0);
}
const credentials=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8'});
const token=credentials.split('\n').find(line=>line.startsWith('password='))?.slice(9).trim();
if(!token)throw Error('GitHub credentials unavailable.');
const headers={Authorization:`Bearer ${token}`,'User-Agent':'MicoCode-Release','Accept':'application/vnd.github+json'};
const api='https://api.github.com/repos/ahpah-dev/MicoCode';
async function request(url,options={}){
 const response=await fetch(url,{...options,headers:{...headers,...options.headers}});
 if(!response.ok)throw Error(`GitHub request failed: ${response.status}`);
 return response.json();
}
const draftArg=process.argv.indexOf('--draft-id');
let release;
if(draftArg>=0){
 const id=process.argv[draftArg+1];
 if(!/^\d+$/.test(id||''))throw Error('Invalid draft release ID.');
 release=await request(`${api}/releases/${id}`);
 if(!release.draft||release.tag_name!==tag||release.target_commitish!==sha)throw Error('Draft does not match this verified commit.');
}else{
 const existing=await fetch(`${api}/releases/tags/${tag}`,{headers});
 if(existing.status!==404)throw Error('Release already exists, or GitHub lookup failed.');
 release=await request(`${api}/releases`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tag_name:tag,target_commitish:sha,name:`MicoCode ${version} — FreeLLMAPI connection fixes`,body:notes+`\n\nSource commit: ${sha}\n\n### SHA-256\n\n\`\`\`\n${sums}\n\`\`\`\n`,draft:true,prerelease:false})});
}
for(const asset of assets){
 const existing=release.assets?.find(item=>item.name===asset.name);
 if(existing){
  if(existing.state!=='uploaded'||existing.size!==asset.data.length||existing.digest!==`sha256:${asset.hash}`)throw Error(`Existing asset does not match: ${asset.name}`);
 }else{
  console.log(`Uploading ${asset.name} (${(asset.data.length/1048576).toFixed(1)} MB)`);
  const uploaded=await request(release.upload_url.replace(/\{.*$/,'')+`?name=${encodeURIComponent(asset.name)}`,{method:'POST',headers:{'Content-Type':asset.type,'Content-Length':String(asset.data.length)},body:asset.data});
  if(uploaded.state!=='uploaded'||uploaded.size!==asset.data.length||uploaded.digest!==`sha256:${asset.hash}`)throw Error(`Upload verification failed: ${asset.name}`);
 }
}
const remoteAssets=await request(`${api}/releases/${release.id}/assets`);
for(const asset of assets){
 const remote=remoteAssets.find(item=>item.name===asset.name);
 if(remote?.state!=='uploaded'||remote.size!==asset.data.length||remote.digest!==`sha256:${asset.hash}`)throw Error(`Final asset verification failed: ${asset.name}`);
}
if(draftArg>=0){console.log(`Verified draft ${release.id}; ready to publish.`)}
else{
 release=await request(`${api}/releases/${release.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({draft:false,prerelease:false,make_latest:'true'})});
 console.log(`Published ${release.html_url}`);
}
