import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safePath,isPrivatePath,mergeFiles,validateReply,checkProject,diffLines} from '../lib/mico/core.mjs';
test('workspace paths reject traversal and prototype mutation',()=>{for(const p of ['../secret','/root','a/../b','__proto__','x/constructor','C:\\secret'])assert.throws(()=>safePath(p));assert.equal(safePath('./src/app.js'),'src/app.js')});
test('secrets and dependency directories stay out of agent context',()=>{for(const p of ['.env','.env.local','a/.env.production','key.pem','node_modules/x.js','.git/config'])assert.equal(isPrivatePath(p),true);assert.equal(isPrivatePath('src/app.js'),false)});
test('staged edits are isolated and atomically applied',()=>{const files={'a.txt':'before','b.txt':'keep'};const changes={'a.txt':'after','b.txt':null,'c.txt':'new'};assert.deepEqual(mergeFiles(files,changes),{'a.txt':'after','c.txt':'new'});assert.equal(files['a.txt'],'before');assert.equal(files['b.txt'],'keep')});
test('agent protocol refuses unknown operations, secrets, and malformed writes',()=>{for(const action of [{type:'shell',content:'rm'},{type:'write_file',path:'.env',content:'secret'},{type:'write_file',path:'a.js',content:55}])assert.throws(()=>validateReply(JSON.stringify({message:'x',actions:[action],done:true})));assert.equal(validateReply('```json\n{"message":"Ready","actions":[],"done":true}\n```').done,true)});
test('project checks report broken resources and invalid JSON',()=>{assert.equal(checkProject({'index.html':'<script src="app.js"></script>','app.js':'','a.json':'{}'}).length,0);assert.equal(checkProject({'index.html':'<script src="missing.js"></script>','a.json':'bad'}).length,2)});
test('project checks catch model-added stray head text and request an exact repair',()=>{
 const valid='<html><head><title>MicoCode</title><meta name="viewport" content="width=device-width"></head><body><h1>Welcome</h1></body></html>';
 assert.deepEqual(checkProject({'index.html':valid}),[]);
 const [issue]=checkProject({'index.html':valid.replace('</title>','</title>}')});
 assert.match(issue,/stray text between <head> elements: "}"/);assert.match(issue,/Read the current staged file and remove this stray text/);
});
test('head text checks preserve valid raw script/style/title content, comments and templates',()=>{
 const html=`<!-- <head>outside comment</head> --><html><head data-example="a > b">
 <title>A &lt; B</title>
 <style>.badge::after { content: "< > } </head>"; }</style>
 <script>if (1 < 2 && 3 > 2) { console.log("} <head> </head>"); }</script>
 <!-- } < > <head>comment</head> -->
 <template><div>Valid inert text <template>Nested content</template></div></template>
 <meta name="description" content="A > B"><link rel="stylesheet" href="style.css">
 &#32;\n</head><body>Ordinary body text</body></html>`;
 assert.deepEqual(checkProject({'index.html':html,'style.css':''}),[]);
 assert.deepEqual(checkProject({'index.html':'<html><head><title>Title</title><body>Omitted head end tag</body></html>'}),[]);
});
test('review includes the actual removed and added lines',()=>{const lines=diffLines('one\ntwo\nthree','one\nchanged\nthree');assert.ok(lines.some(l=>l.kind==='remove'&&l.text==='two'));assert.ok(lines.some(l=>l.kind==='add'&&l.text==='changed'))});
