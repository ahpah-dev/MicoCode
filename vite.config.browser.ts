import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import {POST as ai} from './app/api/ai/route';
import {POST as connection} from './app/api/connection/route';
import {GET as models} from './app/api/models/route';

const root=fileURLToPath(new URL('.',import.meta.url));
export default defineConfig({
 root:root+'website',publicDir:root+'public',
 resolve:{alias:{'@':root}},
 plugins:[react(),{name:'micocode-local-api',configureServer(server){
  server.middlewares.use(async(req,res,next)=>{
   const path=(req.url||'').split('?')[0];
   const handler=path==='/api/models'&&req.method==='GET'?models:path==='/api/ai'&&req.method==='POST'?ai:path==='/api/connection'&&req.method==='POST'?connection:null;
   if(!handler)return next();
   try{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);
    const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})});
    const response=await handler(request);res.statusCode=response.status;response.headers.forEach((value,key)=>res.setHeader(key,value));res.end(Buffer.from(await response.arrayBuffer()));
   }catch{res.statusCode=500;res.end(JSON.stringify({error:'Local API request failed.'}))}
  });
 }}],
 worker:{format:'es'},
 server:{host:'127.0.0.1',port:5175,strictPort:true},
 build:{outDir:root+'dist-web',emptyOutDir:true,rollupOptions:{input:{home:root+'website/index.html',app:root+'website/app/index.html'}}}
});
