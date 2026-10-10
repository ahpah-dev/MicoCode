'use client';
import CodeMirror from '@uiw/react-codemirror';
import {javascript} from '@codemirror/lang-javascript';
import {html} from '@codemirror/lang-html';
import {css} from '@codemirror/lang-css';
import {json} from '@codemirror/lang-json';
import {markdown} from '@codemirror/lang-markdown';
import {EditorView} from '@codemirror/view';
import {useMemo} from 'react';
const theme=EditorView.theme({'&':{backgroundColor:'#121516',color:'#c7cfd0',height:'100%',fontSize:'13px'},'.cm-content':{fontFamily:'"JetBrains Mono", Consolas, monospace',padding:'18px 0',caretColor:'#99e6bd'},'.cm-gutters':{backgroundColor:'#121516',color:'#505c5b',border:'none'},'.cm-activeLine':{backgroundColor:'#1b2221'},'.cm-activeLineGutter':{backgroundColor:'#1b2221',color:'#aab5b0'},'.cm-scroller':{overflow:'auto',fontFamily:'"JetBrains Mono", Consolas, monospace',lineHeight:'1.85'},'.cm-selectionBackground':{background:'#324d40 !important'},'&.cm-focused':{outline:'none'},'.cm-cursor':{borderLeftColor:'#a5ebc6'}},{dark:true});
export default function Editor({path,value,onChange,readOnly}:{path:string;value:string;onChange:(s:string)=>void;readOnly:boolean}) {
 const extensions=useMemo(()=>[theme,EditorView.lineWrapping,path.endsWith('.html')?html():/\.[jt]sx?$/.test(path)?javascript({jsx:path.endsWith('x'),typescript:/\.tsx?$/.test(path)}):path.endsWith('.css')?css():path.endsWith('.json')?json():markdown()],[path]);
 return <CodeMirror aria-label={`Code editor for ${path}`} value={value} height="100%" theme="dark" extensions={extensions} onChange={onChange} readOnly={readOnly} basicSetup={{foldGutter:true,highlightActiveLine:true,autocompletion:true,bracketMatching:true}} />;
}
