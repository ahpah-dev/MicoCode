import {lstat,mkdir,readdir,readFile,realpath,rename,unlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isPrivatePath,safePath} from '../lib/mico/core.mjs';

export const folderLimits={files:150,fileBytes:150000,totalBytes:2000000,depth:16};
const supported=/\.(html?|css|[cm]?js|jsx|tsx?|json|md|txt|svg|csv)$/i;
const skippedDirectory=new Set(['.git','node_modules','.next','dist','build','coverage']);

export function supportedFolderFile(input){
 try{const relative=safePath(String(input).replaceAll('\\','/'));return !isPrivatePath(relative)&&supported.test(relative)}catch{return false}
}

/** Read only supported text files, without following symlinks or escaping root. */
export async function scanFolder(directory){
 const root=await realpath(directory),files={};let total=0;
 async function walk(current,prefix='',depth=0){
  if(depth>folderLimits.depth)throw new Error('This folder is nested too deeply to open safely.');
  const entries=await readdir(current,{withFileTypes:true});
  for(const entry of entries){
   if(entry.isSymbolicLink())continue;
   const relative=prefix?prefix+'/'+entry.name:entry.name;
   if(entry.isDirectory()){
    if(entry.name.startsWith('.')||skippedDirectory.has(entry.name))continue;
    if(!isPrivatePath(relative+'/'))await walk(path.join(current,entry.name),relative,depth+1);
    continue;
   }
   if(!entry.isFile()||!supportedFolderFile(relative))continue;
   const stat=await lstat(path.join(current,entry.name));
   if(stat.size>folderLimits.fileBytes)throw new Error(relative+' is larger than 150 KB. Large assets and generated files are excluded.');
   if(Object.keys(files).length>=folderLimits.files)throw new Error('This folder has more than 150 supported text files. Open a smaller source folder or import a focused subfolder.');
   total+=stat.size;
   if(total>folderLimits.totalBytes)throw new Error('This folder has more than 2 MB of supported text. Open a smaller source folder or import a focused subfolder.');
   files[relative]=await readFile(path.join(current,entry.name),'utf8');
  }
 }
 await walk(root);
 return {root,name:path.basename(root),files,totalBytes:total};
}

async function ensureSafeParent(root,relative){
 const parts=relative.split('/').slice(0,-1);let current=root;
 for(const part of parts){
  current=path.join(current,part);
  try{const stat=await lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('A folder path now contains a link or non-folder. No changes were written there.');}
  catch(error){if(error.code!=='ENOENT')throw error;await mkdir(current);}
 }
 return path.join(root,...relative.split('/'));
}

/** Write only an explicitly reviewed changes map beneath the selected folder. */
export async function applyFolderChanges(directory,changes){
 const root=await realpath(directory),pending=Object.entries(changes||{}),written=[],deleted=[];
 for(const [raw,content] of pending){
  const relative=safePath(String(raw).replaceAll('\\','/'));
  if(!supportedFolderFile(relative))throw new Error('Refusing to write unsupported or private path: '+relative);
  if(content!==null&&typeof content!=='string')throw new Error('Folder changes must contain text or null deletions.');
  if(typeof content==='string'&&content.length>folderLimits.fileBytes)throw new Error(relative+' exceeds the 150 KB per-file limit.');
  const target=await ensureSafeParent(root,relative);
  try{const stat=await lstat(target);if(stat.isSymbolicLink()||!stat.isFile())throw new Error('Refusing to replace a link or non-file: '+relative);}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(content===null){try{await unlink(target);deleted.push(relative)}catch(error){if(error.code!=='ENOENT')throw error}}
  else{
   const temporary=target+'.mico-'+randomUUID()+'.tmp';
   try{await writeFile(temporary,content,{encoding:'utf8',flag:'wx'});await rename(temporary,target);written.push(relative)}catch(error){await unlink(temporary).catch(()=>{});throw error}
  }
 }
 return {written,deleted};
}
