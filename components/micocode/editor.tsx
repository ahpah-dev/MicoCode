'use client';
import CodeMirror from '@uiw/react-codemirror';
import {javascript} from '@codemirror/lang-javascript';
import {html} from '@codemirror/lang-html';
import {css} from '@codemirror/lang-css';
import {json} from '@codemirror/lang-json';
import {markdown} from '@codemirror/lang-markdown';
import {EditorView} from '@codemirror/view';
import {useMemo} from 'react';
import {themes,useTheme} from '@/lib/mico/appearance';
export default function Editor({path,value,onChange,readOnly}:{path:string;value:string;onChange:(s:string)=>void;readOnly:boolean}) {
 const [themeId]=useTheme();const dark=themes.find(t=>t.id===themeId)!.dark;
 const extensions=useMemo(()=>[EditorView.theme({'&':{backgroundColor:'var(--editor-bg)',color:'var(--text)',height:'100%',maxHeight:'100%',fontSize:'var(--editor-font-size,13px)'},'.cm-content':{fontFamily:'"JetBrains Mono", Consolas, monospace',padding:'18px 0',caretColor:'var(--mint)'},'.cm-gutters':{backgroundColor:'var(--editor-bg)',color:'var(--faint)',border:'none'},'.cm-activeLine':{backgroundColor:'var(--editor-line)'},'.cm-activeLineGutter':{backgroundColor:'var(--editor-line)',color:'var(--muted)'},'.cm-scroller':{overflow:'auto !important',fontFamily:'"JetBrains Mono", Consolas, monospace',lineHeight:'1.85',height:'100% !important',maxHeight:'100% !important'},'.cm-selectionBackground':{background:'var(--editor-selection) !important'},'&.cm-focused':{outline:'none'},'.cm-cursor':{borderLeftColor:'var(--mint)'}},{dark}),EditorView.lineWrapping,path.endsWith('.html')?html():/\.[jt]sx?$/.test(path)?javascript({jsx:path.endsWith('x'),typescript:/\.tsx?$/.test(path)}):path.endsWith('.css')?css():path.endsWith('.json')?json():markdown()],[path,dark,themeId]);
  // The app supplies its own surface and syntax-aware theme extensions. The
  // stock dark/light theme paints an unrelated slate rectangle over them.
  return <CodeMirror aria-label={`Code editor for ${path}`} value={value} height="100%" className="cm-theme editor-cm-root" theme="none" extensions={extensions} onChange={onChange} readOnly={readOnly} basicSetup={{foldGutter:true,highlightActiveLine:true,autocompletion:true,bracketMatching:true}} />;
}
