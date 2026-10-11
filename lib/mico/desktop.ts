import type {Config} from './types';
export type ManagedProvider='9router'|'cliproxy'|'litellm'|'ollama';
export type SetupProgress={provider:ManagedProvider;stage:'download'|'install'|'start'|'configure'|'verify'|'ready'|'warning'|'error'|'cancelled';message:string;percent?:number};
export type SetupResult={config:Partial<Config>;key:string;dashboard?:string;catalogueWarning?:string};
export type OpenFolderResult={root:string;name:string;files:Record<string,string>;totalBytes:number};
export type ProviderStatus={provider:ManagedProvider;installed:boolean;running:boolean};
export type DesktopAPI={
 version:string;
 setup:(provider:ManagedProvider,engine?:'local'|'community')=>Promise<SetupResult>;
 cancelSetup:()=>Promise<void>;
 providerStatus:()=>Promise<ProviderStatus[]>;
 refreshModels:()=>Promise<SetupResult>;
 onProgress:(callback:(event:SetupProgress)=>void)=>()=>void;
 openDashboard:(provider:ManagedProvider)=>Promise<void>;
 stopProvider:(provider:ManagedProvider)=>Promise<void>;
 appearance:(theme:string)=>Promise<void>;
 openFolder:()=>Promise<OpenFolderResult|null>;
 applyFolderChanges:(folder:string,changes:Record<string,string|null>)=>Promise<{written:string[];deleted:string[]}>;
 restoreConnection:()=>Promise<SetupResult|null>;
};
declare global{interface Window{micoDesktop?:DesktopAPI}}
export function isManagedProvider(id:string):id is ManagedProvider{return ['9router','cliproxy','litellm','ollama'].includes(id)}
