import type {AgentSide, UiDensity, UiTextSize} from './interface';
export type Files = Record<string, string>;
export type Changes = Record<string, string | null>;
export type Message = { id:string; role:'user'|'assistant'|'activity'|'error'; text:string; time:number };
export type Checkpoint = { id:string; name:string; time:number; files:Files };
export type Project = { id:string; name:string; files:Files; active:string; messages:Message[]; checkpoints:Checkpoint[]; changes:Changes; updated:number; sourceFolder?:string };
export type ProxyPreset = '9router'|'litellm'|'cliproxy'|'omniroute'|'freeride'|'aistudio'|'aihubmix'|'nim'|'horde'|'opencode'|'custom';
export type Config = {
 managed?:boolean;
 routerModels?:string[];
 routerEngine?:'local'|'community';
 provider:'browser'|'ollama'|'openrouter'|'proxy'; model:string; ollamaUrl:string;
 browserSize:'9B'|'8B'; temperature:number; maxSteps:number;
 proxyPreset:ProxyPreset; proxyUrl:string; freeModels:string[]; routerFreeOnly:boolean;
 resilience:boolean; compactContext:boolean; freeFallback:boolean; quality:'polished'|'focused';
  uiDensity:UiDensity; uiTextSize:UiTextSize; editorFont:number; reduceMotion:boolean; agentSide:AgentSide; showTips:boolean;
};
export type AgentAction = {
  type:'read_file'|'write_file'|'edit_file'|'delete_file'|'search'|'list_files'|'check_project'|'review_quality'|'publish'|'git';
  path?:string; content?:string; query?:string; find?:string; replace?:string; startLine?:number; endLine?:number;
  target?:'github'|'vercel'|'netlify'|'custom'; repo?:string; message?:string;
  command?:'status'|'commit'|'push'|'pull'|'init'|'log'|'branch'|'diff';
};
export type AgentReply = { message:string; actions:AgentAction[]; done:boolean };
export const defaultConfig:Config = {provider:'openrouter',model:'openrouter/free',ollamaUrl:'http://localhost:11434',browserSize:'9B',temperature:0.2,maxSteps:0,proxyPreset:'9router',proxyUrl:'http://127.0.0.1:20128/v1',freeModels:[],routerFreeOnly:false,resilience:true,compactContext:true,freeFallback:true,quality:'polished',uiDensity:'comfortable',uiTextSize:'standard',editorFont:13,reduceMotion:false,agentSide:'right',showTips:true};
export const uid = () => crypto.randomUUID();
