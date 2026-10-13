import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import JSZip from 'jszip';
import {ProviderManager} from '../desktop/provider-manager.mjs';

// FreeLLMAPI is the one managed provider whose key this app does not own: its /v1
// surface is bearer-gated and stays empty until the user pastes their own provider key
// and unified key. These tests pin the two things that made setup impossible:
//   1. the shared providers\npmrc pins ignore-scripts=true, which silently skips
//      better-sqlite3's install script, and the archive's bare npm\ layout leaves npm
//      unable to resolve itself so `npm run build` fails with MODULE_NOT_FOUND;
//   2. verifying /v1/models mid-setup 401s, aborting setup and stopping the server the
//      user needs in order to add that key in the first place.

const REPO_NAME='freellmapi-0.13.10';
const REPO_FILES=['server/package.json','client/package.json','cli/package.json','package.json'];

async function fakeManager(t,{requests=[]}={}){
 const base=await mkdtemp(path.join(os.tmpdir(),'mico-freellmapi-'));
 const dataDir=path.join(base,'data');
 const runtime=path.join(base,'node-runtime');
 await mkdir(runtime,{recursive:true});
 // node.exe is only ever passed to the stubbed run()/start(), so a placeholder is enough.
 await writeFile(path.join(runtime,'node.exe'),'');
 // A real archive so the extraction path is genuinely exercised. Its internal layout is
 // the one the bundler produces: npm\ at the archive root.
 const zip=new JSZip();
 zip.file('npm/bin/npm-cli.js','');
 zip.file('npm/bin/npm.cmd','');
 await writeFile(path.join(runtime,'npm-runtime.zip'),await zip.generateAsync({type:'nodebuffer'}));
 const manager=new ProviderManager({
  dataDir,runtimeDir:runtime,gatewayBase:'http://127.0.0.1:19286/managed/v1',gatewayKey:'internal',vault:{},
  fetchImpl:async url=>{
   requests.push(String(url));
   // The dashboard root answers; the authenticated catalogue answers 401, which is the
   // exact condition that used to abort setup.
   return String(url).endsWith('/v1/models')
    ? Response.json({error:{message:'Invalid API key'}},{status:401})
    : Response.json({ok:true});
  },
 });
 t.after(()=>rm(base,{recursive:true,force:true}));
 // The verified download and extraction are exercised elsewhere; here the source tree is
 // seeded directly so these tests pin the install shape and the verify decision.
 manager.installZip=async id=>{
  const dir=manager.versionFolder(id);
  await mkdir(dir,{recursive:true});
  return dir;
 };
 return {manager,dataDir,runtime};
}

// Lay down the extracted source archive the way extractVerifiedZip leaves it.
async function seedRepo(manager){
 const dir=manager.versionFolder('freellmapi');
 const repo=path.join(dir,REPO_NAME);
 for(const file of REPO_FILES){const full=path.join(repo,file);await mkdir(path.dirname(full),{recursive:true});await writeFile(full,'{}')}
 return {dir,repo};
}

function stubRun(manager,calls){
 manager.run=async(file,args,options)=>{
  calls.push({file,args,cwd:options?.cwd});
  // `npm run build` is what produces the artifact ready() would otherwise never see.
  if(args.includes('run')&&args.includes('build')){
   const dist=path.join(options.cwd,'dist');
   await mkdir(dist,{recursive:true});
   await writeFile(path.join(dist,'index.js'),'');
  }
  return {code:0};
 };
}

function stubStart(manager){
 manager.start=(id,file,args,options)=>{
  const child={id,file,args,options,exitCode:null};
  manager.children.set(id,child);
  return child;
 };
}

test('FreeLLMAPI opts out of the inherited ignore-scripts and gives npm a resolvable layout',async t=>{
 const {manager}=await fakeManager(t);
 const {repo}=await seedRepo(manager);
 const calls=[];
 stubRun(manager,calls);
 stubStart(manager);

 await manager.setupFreeLLMAPI(AbortSignal.timeout(20000),'http://127.0.0.1:19286/managed/community/v1');

 // The fix: this provider must not inherit the shared npmrc's ignore-scripts=true,
 // or better-sqlite3's install script never runs and the server dies on the binding.
 const npmrc=await readFile(path.join(repo,'.npmrc'),'utf8');
 assert.match(npmrc,/ignore-scripts=false/);
 assert.match(npmrc,/registry=https:\/\/registry\.npmjs\.org\//);

 // npm resolves itself as node_modules/npm relative to its own bin directory. Leaving
 // only the bare npm\ folder is what made `npm run build` die with MODULE_NOT_FOUND.
 assert.deepEqual(calls.map(c=>path.basename(c.args[0])),['npm-cli.js','npm-cli.js']);
 for(const call of calls){
  assert.ok(call.args[0].includes(path.join('node_modules','npm','bin','npm-cli.js')),
   'npm must be invoked from the resolvable layout, got '+call.args[0]);
 }
 // install and build ran exactly once each; the archive was not re-extracted over them.
 assert.deepEqual(calls.map(c=>c.args.slice(1,3).join(' ')),['install --no-audit','run build']);
});

test('FreeLLMAPI setup returns a usable connection while its catalogue is still empty',async t=>{
 const {manager}=await fakeManager(t);
 const {repo}=await seedRepo(manager);
 const calls=[];
 stubRun(manager,calls);
 stubStart(manager);
 const progress=[];
 manager.notify=p=>progress.push(p);

 const connection=await manager.setupFreeLLMAPI(AbortSignal.timeout(20000),'http://127.0.0.1:19286/managed/community/v1');

 // Before the fix this rejected with "did not accept its connection (401)" from verify().
 assert.equal(connection.config.proxyPreset,'freellmapi');
 assert.equal(connection.dashboard,'http://127.0.0.1:3001');
 assert.equal(connection.config.proxyUrl,'http://127.0.0.1:3001/v1');
 // It reports exactly what the user has to do next, rather than failing setup.
 assert.ok(progress.some(p=>/add the provider keys you want/.test(p.message||'')));
 assert.ok(progress.some(p=>/Still installing/.test(p.message||'')===false));
});

test('a fully installed FreeLLMAPI skips install and build entirely',async t=>{
 const {manager}=await fakeManager(t);
 const {repo}=await seedRepo(manager);
 const dist=path.join(repo,'server','dist');
 await mkdir(dist,{recursive:true});
 await writeFile(path.join(dist,'index.js'),'');
 const calls=[];
 stubRun(manager,calls);
 stubStart(manager);

 await manager.setupFreeLLMAPI(AbortSignal.timeout(20000),'http://127.0.0.1:19286/managed/community/v1');
 // The one-time build is cached on disk; re-running it would cost minutes every start.
 assert.deepEqual(calls,[]);
});

test('the generic setup flow verifies every managed provider except FreeLLMAPI',async t=>{
 const {manager}=await fakeManager(t);
 const verified=[];
 manager.verify=async connection=>{verified.push(connection.config.proxyPreset)};
 // setupFreeLLMAPI is stubbed so this pins the verify decision, not the install.
 manager.setupFreeLLMAPI=async()=>({config:{provider:'proxy',proxyPreset:'freellmapi',proxyUrl:'http://127.0.0.1:3001/v1',model:'',freeModels:[],routerFreeOnly:false},key:'',dashboard:'http://127.0.0.1:3001'});
 manager.setupNine=async()=>({config:{provider:'proxy',proxyPreset:'9router',proxyUrl:'http://127.0.0.1:55001/v1',model:'free',freeModels:['free'],routerFreeOnly:true},key:'k'});
 await manager.setup('freellmapi','community');
 assert.deepEqual(verified,[],'FreeLLMAPI must not be verified while it has no key');
 await manager.setup('9router','community');
 assert.deepEqual(verified,['9router'],'other routers must still be verified');
});
