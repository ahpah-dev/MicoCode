export type Files = Record<string, string>;
export type Changes = Record<string, string | null>;
export type Message = { id:string; role:'user'|'assistant'|'activity'|'error'; text:string; time:number };
export type Checkpoint = { id:string; name:string; time:number; files:Files };
export type Project = { id:string; name:string; files:Files; active:string; messages:Message[]; checkpoints:Checkpoint[]; changes:Changes; updated:number };
export type ProxyPreset = '9router'|'litellm'|'cliproxy'|'horde'|'opencode'|'custom';
export type Config = {
 managed?:boolean;
 routerModels?:string[];
 routerEngine?:'local'|'community';
 provider:'browser'|'ollama'|'openrouter'|'proxy'; model:string; ollamaUrl:string;
 browserSize:'0.5B'|'1.5B'|'3B'; temperature:number; maxSteps:number;
 proxyPreset:ProxyPreset; proxyUrl:string; freeModels:string[]; routerFreeOnly:boolean;
 resilience:boolean; compactContext:boolean; freeFallback:boolean; quality:'polished'|'focused';
};
export type AgentAction = { type:'read_file'|'write_file'|'edit_file'|'delete_file'|'search'|'list_files'|'check_project'|'review_quality'; path?:string; content?:string; query?:string; find?:string; replace?:string; startLine?:number; endLine?:number };
export type AgentReply = { message:string; actions:AgentAction[]; done:boolean };
export const defaultConfig:Config = {provider:'browser',model:'openrouter/free',ollamaUrl:'http://localhost:11434',browserSize:'1.5B',temperature:0.2,maxSteps:12,proxyPreset:'9router',proxyUrl:'http://127.0.0.1:20128/v1',freeModels:[],routerFreeOnly:false,resilience:true,compactContext:true,freeFallback:true,quality:'polished'};
export const uid = () => crypto.randomUUID();
