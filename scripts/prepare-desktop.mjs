import {build} from 'esbuild';
import {mkdir,readFile,writeFile,cp,access,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import {versions} from '../desktop/artifacts.mjs';
import {downloadVerified,extractVerifiedZip} from '../desktop/install.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'build','desktop-app'),resources=path.join(root,'build','resources');
await mkdir(out,{recursive:true});await mkdir(resources,{recursive:true});
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
await build({entryPoints:[path.join(root,'desktop','main.mjs')],outfile:path.join(out,'main.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron'],logLevel:'warning'});
await cp(path.join(root,'desktop','preload.cjs'),path.join(out,'preload.cjs'));
await cp(path.join(root,'dist-web'),path.join(out,'web'),{recursive:true});
await cp(path.join(root,'LICENSE'),path.join(out,'LICENSE'));
await writeFile(path.join(out,'package.json'),JSON.stringify({name:'micocode-desktop',productName:'MicoCode',version:pkg.version,description:'Little ideas. Real things. A free agentic coding workspace.',author:'MicoCode contributors',license:'MIT',main:'main.cjs'},null,2));

// Rasterize the existing M mark directly for Windows' icon container, without an external image service.
const size=256,scale=2,rgba=Buffer.alloc(size*size*4);
const distance=(x,y,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1];const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)};
const lines=[[[70,178],[70,89]],[[70,89],[128,147]],[[128,147],[186,89]],[[186,89],[186,178]],[[128,55],[128,70]]];
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
 let covered=0,mark=0;for(let yy=0;yy<scale;yy++)for(let xx=0;xx<scale;xx++){
  const px=x+(xx+.5)/scale,py=y+(yy+.5)/scale,cx=Math.max(58,Math.min(198,px)),cy=Math.max(58,Math.min(198,py));
  if(Math.hypot(px-cx,py-cy)<=45&&px>=13&&px<=243&&py>=13&&py<=243){covered++;if(lines.some(([a,b])=>distance(px,py,a,b)<10))mark++}
 }
 const i=(y*size+x)*4,ratio=covered?mark/covered:0;rgba[i]=Math.round(165*(1-ratio)+20*ratio);rgba[i+1]=Math.round(234*(1-ratio)+35*ratio);rgba[i+2]=Math.round(200*(1-ratio)+27*ratio);rgba[i+3]=Math.round(covered/4*255);
}
function crc(buf){let c=0xffffffff;for(const byte of buf){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
function chunk(type,data){const head=Buffer.alloc(8),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);head.write(type,4);tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(type),data])));return Buffer.concat([head,data,tail])}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
const scan=Buffer.alloc((size*4+1)*size);for(let y=0;y<size;y++)rgba.copy(scan,y*(size*4+1)+1,y*size*4,(y+1)*size*4);
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18);
await writeFile(path.join(out,'icon.ico'),Buffer.concat([ico,png]));await writeFile(path.join(root,'desktop','icon.png'),png);

const nodeDir=path.join(resources,'node-runtime');
try{await access(path.join(nodeDir,'node.exe'))}catch{
 const release='node-v'+versions.node+'-win-x64',zipName=release+'.zip';
 const checks=await(await fetch('https://nodejs.org/dist/v'+versions.node+'/SHASUMS256.txt')).text();
 const sha256=checks.split('\n').find(line=>line.endsWith('  '+zipName))?.split(' ')[0];if(!/^[a-f0-9]{64}$/.test(sha256||''))throw new Error('Official Node checksum was not found.');
 const zip=path.join(resources,zipName),stage=path.join(resources,'node-extract');
 console.log('Downloading the official Node '+versions.node+' runtime…');
 await downloadVerified({url:'https://nodejs.org/dist/v'+versions.node+'/'+zipName,sha256,maxBytes:70000000},zip,AbortSignal.timeout(180000));
 await extractVerifiedZip(zip,stage);await cp(path.join(stage,release),nodeDir,{recursive:true});await rm(stage,{recursive:true,force:true});await rm(zip,{force:true});
 await writeFile(path.join(nodeDir,'mico-runtime.json'),JSON.stringify({version:versions.node,sha256}));
}
console.log('Desktop workspace and private runtime are ready.');
