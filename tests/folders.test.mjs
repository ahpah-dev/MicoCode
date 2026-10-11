import {test} from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {applyFolderChanges,scanFolder,supportedFolderFile} from '../desktop/folders.mjs';

test('folder scan loads supported source files and excludes private/dependency content',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mico-open-folder-'));
 try{
  await mkdir(path.join(root,'src'),{recursive:true});
  await mkdir(path.join(root,'node_modules','ignored'),{recursive:true});
  await writeFile(path.join(root,'index.html'),'<h1>Hello</h1>');
  await writeFile(path.join(root,'src','app.tsx'),'export const app = 1;');
  await writeFile(path.join(root,'.env'),'PRIVATE=1');
  await writeFile(path.join(root,'node_modules','ignored','index.js'),'ignore');
  await writeFile(path.join(root,'image.png'),Buffer.from([1,2,3]));
  const opened=await scanFolder(root);
  assert.equal(opened.name,path.basename(root));
  assert.equal(opened.files['index.html'],'<h1>Hello</h1>');
  assert.equal(opened.files['src/app.tsx'],'export const app = 1;');
  assert.equal(Object.keys(opened.files).length,2);
  assert.equal(Object.hasOwn(opened.files,'.env'),false);
  assert.equal(Object.keys(opened.files).some(p=>p.includes('node_modules')),false);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('apply writes staged edits, new files, and deletions only under the chosen folder',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mico-apply-folder-'));
 try{
  await writeFile(path.join(root,'index.html'),'<h1>Old</h1>');
  await writeFile(path.join(root,'remove.css'),'body{}');
  const result=await applyFolderChanges(root,{'index.html':'<h1>New</h1>','src/app.js':'export {};','remove.css':null});
  assert.equal(await readFile(path.join(root,'index.html'),'utf8'),'<h1>New</h1>');
  assert.equal(await readFile(path.join(root,'src','app.js'),'utf8'),'export {};');
  await assert.rejects(()=>readFile(path.join(root,'remove.css')),{code:'ENOENT'});
  assert.deepEqual(result.written,['index.html','src/app.js']);
  assert.deepEqual(result.deleted,['remove.css']);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('folder writes reject traversal, private paths, unsupported files, and oversized content',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mico-invalid-folder-'));
 try{
  await assert.rejects(()=>applyFolderChanges(root,{'../outside.js':'no'}));
  await assert.rejects(()=>applyFolderChanges(root,{'.env':'SECRET=1'}));
  await assert.rejects(()=>applyFolderChanges(root,{'image.png':'not source'}));
  await assert.rejects(()=>applyFolderChanges(root,{'large.js':'x'.repeat(150001)}),/150 KB/);
  assert.equal(supportedFolderFile('src/index.html'),true);
  assert.equal(supportedFolderFile('node_modules/pkg/index.js'),false);
  assert.equal(supportedFolderFile('.env'),false);
 }finally{await rm(root,{recursive:true,force:true})}
});
