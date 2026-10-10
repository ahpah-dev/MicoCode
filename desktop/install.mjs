import {createWriteStream,createReadStream} from 'node:fs';
import {mkdir,rename,rm,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Transform,Readable} from 'node:stream';
import path from 'node:path';
import yauzl from 'yauzl';

export function archivePath(directory,name){
 if(typeof name!=='string'||!name||name.includes('\0')||name.includes('\\')||name.startsWith('/')||name.includes(':')||name.split('/').some(p=>p==='..'||p==='.'))throw new Error('Unsafe archive path.');
 const target=path.resolve(directory,name);
 if(!target.startsWith(path.resolve(directory)+path.sep))throw new Error('Archive path is outside its destination.');
 return target;
}
export async function downloadVerified(artifact,destination,signal,onProgress=()=>{}){
 await mkdir(path.dirname(destination),{recursive:true});
 const partial=destination+'.partial';
 try{
  const r=await fetch(artifact.url,{signal,redirect:'follow'});
  if(!r.ok||!r.body)throw new Error('The official provider download is unavailable ('+r.status+'). Please retry.');
  if(new URL(r.url).protocol!=='https:')throw new Error('Provider downloads must use HTTPS.');
  const total=Number(r.headers.get('content-length'))||0;
  if(total>artifact.maxBytes)throw new Error('Provider download exceeded its expected size.');
  let bytes=0,last=-1;const hash=createHash('sha256');
  const meter=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;if(bytes>artifact.maxBytes)return callback(new Error('Provider download is too large.'));hash.update(chunk);const percent=total?Math.min(100,Math.round(bytes/total*100)):undefined;if(percent!==last){last=percent;onProgress(percent)}callback(null,chunk)}});
  await pipeline(Readable.fromWeb(r.body),meter,createWriteStream(partial,{flags:'w'}),{signal});
  if(hash.digest('hex')!==artifact.sha256)throw new Error('The downloaded provider failed its checksum verification. Nothing was installed.');
  await rename(partial,destination);
 }catch(e){await rm(partial,{force:true});throw e}
}
export async function extractVerifiedZip(archive,directory,signal){
 // Always extract into a fresh private directory. Reject links, duplicate entries, devices, and traversal.
 const staging=directory+'.extract-'+randomUUID();await mkdir(staging,{recursive:true});
 try{
  await new Promise((resolve,reject)=>{
   yauzl.open(archive,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
    if(error)return reject(error);
    let settled=false,total=0,count=0;
    const finish=(e)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);zip.close();e?reject(e):resolve()};
    const abort=()=>finish(new Error('Setup cancelled.'));signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)return abort();
    zip.on('error',finish);zip.on('end',()=>finish());
    zip.on('entry',async entry=>{
     try{
      if(signal?.aborted)throw new Error('Setup cancelled.');
      if(++count>100000||(total+=entry.uncompressedSize)>6500000000)throw new Error('Archive exceeded its extraction limit.');
      const kind=(entry.externalFileAttributes>>>16)&0o170000;
      if(kind&&kind!==0o100000&&kind!==0o040000)throw new Error('Links and special files are not allowed in provider archives.');
      const target=archivePath(staging,entry.fileName);
      if(entry.fileName.endsWith('/')){await mkdir(target,{recursive:true});zip.readEntry();return}
      await mkdir(path.dirname(target),{recursive:true});
      zip.openReadStream(entry,(error,stream)=>{
       if(error)return finish(error);
       pipeline(stream,createWriteStream(target,{flags:'wx'}),...(signal?[{signal}]:[])).then(()=>zip.readEntry(),finish);
      });
     }catch(e){finish(e)}
    });zip.readEntry();
   });
  });
  await mkdir(path.dirname(directory),{recursive:true});
  try{await stat(directory);throw new Error('Install destination already exists.')}catch(e){if(e.code!=='ENOENT')throw e}
  await rename(staging,directory);
 }finally{await rm(staging,{recursive:true,force:true})}
}
export async function fileHash(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex')}
