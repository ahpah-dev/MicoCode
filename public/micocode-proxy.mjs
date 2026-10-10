// MicoCode local inference relay. Node.js 22+; no dependencies or API key.
// Start: node micocode-proxy.mjs --origin https://your-micocode-site
// Only forwards model listing and chat to Ollama on this computer.
import http from 'node:http';
const originIndex=process.argv.indexOf('--origin');
const origin=originIndex>=0?new URL(process.argv[originIndex+1]).origin:'https://micocode.vercel.app';
const allowed=new Set([origin,'http://localhost:5174','http://127.0.0.1:5174','http://localhost:5175','http://127.0.0.1:5175']);
let running=false;
const server=http.createServer(async(req,res)=>{
 const requestOrigin=req.headers.origin;
 if(req.headers.host!=='127.0.0.1:11435'&&req.headers.host!=='localhost:11435'){res.writeHead(403);res.end('Invalid host');return}
 if(requestOrigin&&!allowed.has(requestOrigin)){res.writeHead(403);res.end('Origin not allowed');return}
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(requestOrigin?{'Access-Control-Allow-Origin':requestOrigin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Private-Network':'true'}:{})};
 const respond=(status,body)=>{res.writeHead(status,headers);res.end(JSON.stringify(body))};
 if(req.method==='OPTIONS'){res.writeHead(204,headers);res.end();return}
 const route=(req.url||'').split('?')[0];
 if(!((req.method==='GET'&&route==='/api/tags')||(req.method==='POST'&&route==='/api/chat'))){respond(404,{error:'Only model discovery and chat are supported.'});return}
 if(req.method==='POST'&&running){respond(429,{error:'A local generation is already running. Try again when it finishes.'});return}
 const abort=new AbortController();res.on('close',()=>{if(!res.writableEnded)abort.abort()});
 const timeout=setTimeout(()=>abort.abort(),300000);let ownsSlot=false;
 try{
  let body;
  if(req.method==='POST'){
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>400000){respond(413,{error:'Request too large'});return}}
   const parsed=JSON.parse(raw);
   if(typeof parsed.model!=='string'||!Array.isArray(parsed.messages)){respond(400,{error:'Invalid request'});return}
   body=JSON.stringify({model:parsed.model,messages:parsed.messages,format:parsed.format,stream:false,think:false,keep_alive:'5m',options:{temperature:0.2,num_predict:4096,...(parsed.options||{})}});
   running=true;ownsSlot=true;
  }
  const upstream=await fetch('http://127.0.0.1:11434'+route,{method:req.method,headers:{'Content-Type':'application/json'},body,signal:abort.signal});
  const data=await upstream.json();respond(upstream.status,data);
 }catch(e){if(!res.destroyed)respond(502,{error:e.name==='AbortError'?'Local generation timed out or stopped.':'Ollama is unavailable. Start Ollama and retry.'})}finally{clearTimeout(timeout);if(ownsSlot)running=false}
});
server.listen(11435,'127.0.0.1',()=>console.log('MicoCode local relay: http://127.0.0.1:11435 | allowed site: '+origin));
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'MicoCode relay is already running on port 11435.':e.message);process.exit(1)});
