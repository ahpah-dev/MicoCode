import {Check} from 'lucide-react';
import {themes,useTheme} from '@/lib/mico/appearance';
export function Appearance(){
 const [selected,setTheme]=useTheme();
 return <section className="appearance-settings" aria-label="Appearance">
  <div className="section-label">MAKE YOURSELF AT HOME</div><h3>A little change of scenery.</h3><p>Choose a theme for your workspace and editor. It’s saved on this device.</p>
  <div className="theme-grid">{themes.map(theme=><button key={theme.id} className={'theme-card '+(selected===theme.id?'selected':'')} onClick={()=>setTheme(theme.id)} aria-pressed={selected===theme.id} aria-label={theme.name+' theme'}>
   <span className="theme-preview" style={{background:theme.background,color:theme.accent}}><span className="theme-mini-rail"/><span className="theme-mini-code"><i/><i/><i/></span><span className="theme-mini-agent"><i/><i/><b/></span>{selected===theme.id&&<span className="theme-selected"><Check size={12}/></span>}</span><strong>{theme.name}</strong>
  </button>)}</div>
 </section>;
}
