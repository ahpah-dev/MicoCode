import type {Config} from './types';
export type ManagedProvider='9router'|'cliproxy'|'litellm'|'ollama';
export type SetupProgress={provider:ManagedProvider;stage:'download'|'install'|'start'|'configure'|'verify'|'ready'|'error'|'cancelled';message:string;percent?:number};
export type SetupResult={config:Partial<Config>;key:string;dashboard?:string};
export type ProviderStatus={provider:ManagedProvider;installed:boolean;running:boolean};
export type DesktopAPI={
 version:string;
 setup:(provider:ManagedProvider,engine?:'local'|'community')=>Promise<SetupResult>;
 cancelSetup:()=>Promise<void>;
 providerStatus:()=>Promise<ProviderStatus[]>;
 onProgress:(callback:(event:SetupProgress)=>void)=>()=>void;
 openDashboard:(provider:ManagedProvider)=>Promise<void>;
 stopProvider:(provider:ManagedProvider)=>Promise<void>;
 appearance:(theme:string)=>Promise<void>;
 restoreConnection:()=>Promise<SetupResult|null>;
};
declare global{interface Window{micoDesktop?:DesktopAPI}}
export function isManagedProvider(id:string):id is ManagedProvider{return ['9router','cliproxy','litellm','ollama'].includes(id)}
