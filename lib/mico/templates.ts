import {uid,type Project,type Files} from './types';
const baseCss=`* { box-sizing: border-box; } body { margin: 0; font-family: system-ui, sans-serif; background: #f5f5ef; color: #222a21; } button, a { font: inherit; } button { cursor: pointer; } a { color: inherit; }`;
const landing:Files={
 'index.html':`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>First light — a fresh start</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <nav><a class="brand" href="#">◒ first light</a><a href="#about">A little about us ↗</a></nav>
  <main>
    <span class="eyebrow">MADE FOR NEW BEGINNINGS</span>
    <h1>Good things<br>start with an idea.</h1>
    <p>A little curiosity. A spark of possibility.<br>Make something that feels like you.</p>
    <button id="start">Find your spark <span>↗</span></button>
    <div class="sculpture"><i></i><i></i><i></i><i></i></div>
    <div class="note" id="note" aria-live="polite"></div>
  </main>
  <footer id="about"><span>Small beginnings. Endless possibilities.</span><span>Built with MicoCode ✳</span></footer>
  <script src="app.js"></script>
</body>
</html>`,
 'styles.css':baseCss+`
nav { display:flex; justify-content:space-between; align-items:center; padding:28px 7%; font-size:12px; } nav a { text-decoration:none; } .brand { font-size:20px; font-weight:700; letter-spacing:-1px; }
main { position:relative; padding:76px 7% 90px; min-height:470px; overflow:hidden; } .eyebrow { font-size:10px; letter-spacing:2px; color:#5c7457; } h1 { position:relative;z-index:1;font-size:clamp(36px,6.5vw,76px);line-height:1.05;letter-spacing:-3px;font-weight:500;margin:26px 0; } p { position:relative;z-index:1;font-size:14px;line-height:1.8;color:#677160; } button { background:#263f2b;border:0;border-radius:40px;color:white;padding:15px 22px;margin-top:20px;position:relative;z-index:1;font-size:12px; } button span { margin-left:30px; } .sculpture { position:absolute;right:-25px;top:85px;width:250px;height:300px;transform:rotate(-24deg);opacity:.8; } .sculpture i { display:block;width:230px;height:65px;border-radius:60%;background:linear-gradient(150deg,#d9eeb0,#6e9448);box-shadow:3px 14px 25px #778e4330;margin-top:-9px; } footer { padding:24px 7%;border-top:1px solid #dfe2d7;display:flex;justify-content:space-between;gap:15px;font-size:10px;color:#738068; } .note { padding-top:15px;color:#426c35;font-size:12px; } @media(max-width:600px) { .sculpture { opacity:.25;right:-100px; } h1 {letter-spacing:-2px;} nav a:last-child {font-size:10px;} }
`,
 'app.js':`const messages = [
  'Make a little space for your biggest idea.',
  'Start small. See where it takes you.',
  'Your next chapter starts here.'
];
let count = 0;
document.querySelector('#start').addEventListener('click', () => {
  document.querySelector('#note').textContent = messages[count++ % messages.length];
  console.log('A little inspiration, delivered.');
});`,
 'README.md':'# First light\n\nA small website with room for your ideas.\n\n- Edit index.html, styles.css, and app.js.\n- Use Preview to see your changes.\n- Ask Mico to help, then review and apply its edits.\n- Export your project as a ZIP at any time.\n\nThis workspace runs HTML, CSS, and JavaScript in a sandboxed browser preview. Node, npm, and server-side code require your own local runtime.'
};
const blank:Files={'index.html':'<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>My new project</title>\n  <link rel="stylesheet" href="styles.css">\n</head>\n<body>\n  <h1>Hello, possibility.</h1>\n  <script src="app.js"></script>\n</body>\n</html>','styles.css':baseCss+'\nbody { padding: 48px; }','app.js':'// Your next idea starts here.\n'};
const dashboard:Files={
 'index.html':`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Little wins</title><link rel="stylesheet" href="styles.css"></head><body><main><header><span>◒ little wins</span><small>YOUR PERSONAL SPACE</small></header><h1>Make room for progress.</h1><p>One small step at a time.</p><section><article><small>TASKS</small><strong id="total">0</strong></article><article><small>COMPLETED</small><strong id="done">0</strong></article></section><form id="add"><input id="task" placeholder="What's your next little win?" aria-label="New task" required><button>Add task +</button></form><ul id="tasks"></ul></main><script src="app.js"></script></body></html>`,
 'styles.css':baseCss+'\nmain{max-width:760px;margin:auto;padding:40px 24px}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:64px}header span{font-size:22px;font-weight:700}small{font-size:10px;letter-spacing:1px;color:#748069}h1{font-size:36px;letter-spacing:-1.5px;margin-bottom:8px}p{color:#788170}section{display:flex;gap:16px;margin:32px 0}article{flex:1;padding:22px;background:white;border:1px solid #e2e6da;border-radius:16px}strong{display:block;font-size:38px;font-weight:500;margin-top:14px}form{display:flex;gap:10px}input{flex:1;min-width:0;padding:14px;border:1px solid #d8decf;border-radius:10px;font:inherit;background:white}button{background:#294b31;color:white;border:0;border-radius:10px;padding:12px 18px}ul{list-style:none;padding:0}li{display:flex;align-items:center;gap:14px;padding:16px 0;border-bottom:1px solid #dfe4d8}li input{flex:none}li.completed span{text-decoration:line-through;opacity:.5}li button{margin-left:auto;padding:4px 10px;background:transparent;color:#788170}',
 'app.js':`const tasks = [{text:'Make something you love',done:false},{text:'Celebrate a small win',done:true}];
function render(){const list=document.querySelector('#tasks');list.replaceChildren();tasks.forEach((task,i)=>{const li=document.createElement('li');li.className=task.done?'completed':'';const check=document.createElement('input');check.type='checkbox';check.checked=task.done;check.setAttribute('aria-label','Complete '+task.text);check.onchange=()=>{task.done=check.checked;render()};const span=document.createElement('span');span.textContent=task.text;const del=document.createElement('button');del.textContent='×';del.setAttribute('aria-label','Delete '+task.text);del.onclick=()=>{tasks.splice(i,1);render()};li.append(check,span,del);list.append(li)});document.querySelector('#total').textContent=tasks.length;document.querySelector('#done').textContent=tasks.filter(t=>t.done).length;}
document.querySelector('#add').onsubmit=e=>{e.preventDefault();const input=document.querySelector('#task');if(input.value.trim())tasks.push({text:input.value.trim(),done:false});input.value='';render()};render();`
};
export function createProject(kind='landing',name?:string):Project {return {id:uid(),name:name||(kind==='blank'?'Untitled project':kind==='dashboard'?'Little wins':'First light'),files:{...(kind==='blank'?blank:kind==='dashboard'?dashboard:landing)},active:'index.html',messages:[],checkpoints:[],changes:{},updated:Date.now()};}
