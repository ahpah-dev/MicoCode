import type {Config} from './types';
export type ManagedProvider='9router'|'cliproxy'|'litellm'|'ollama';
export type SetupProgress={provider:ManagedProvider;stage:'download'|'install'|'start'|'configure'|'verify'|'ready'|'warning'|'error'|'cancelled';message:string;percent?:number};
export type SetupResult={config:Partial<Config>;key:string;dashboard?:string;catalogueWarning?:string};
export type OpenFolderResult={root:string;name:string;files:Record<string,string>;totalBytes:number};
export type ProviderStatus={provider:ManagedProvider;installed:boolean;running:boolean};
export type GitStatusResult={
 isRepo:boolean;
 branch:string;
 tracking?:string;
 ahead:number;
 behind:number;
 staged:Array<{status:string;file:string}>;
 modified:Array<{status:string;file:string}>;
 untracked:string[];
 clean:boolean;
 lastCommit?:string;
};
export type GitCommitResult={
 success:boolean;
 message:string;
 output:string;
};
export type GitLogItem={
 hash:string;
 shortHash:string;
 author:string;
 timestamp:number;
 date:string;
 message:string;
};
export type DesktopGitAPI={
 isAvailable:()=>Promise<boolean>;
 status:(folder:string)=>Promise<GitStatusResult>;
 init:(folder:string)=>Promise<{success:boolean}>;
 commit:(folder:string,message:string,files?:string[])=>Promise<GitCommitResult>;
 log:(folder:string,max?:number)=>Promise<GitLogItem[]>;
 push:(folder:string,remote?:string,branch?:string)=>Promise<{success:boolean;output:string}>;
 pull:(folder:string,remote?:string,branch?:string)=>Promise<{success:boolean;output:string}>;
 diff:(folder:string,file?:string)=>Promise<string>;
 branch:(folder:string)=>Promise<{current:string;branches:string[]}>;
};
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
 git?:DesktopGitAPI;
};
declare global{interface Window{micoDesktop?:DesktopAPI}}
export function isManagedProvider(id:string):id is ManagedProvider{return ['9router','cliproxy','litellm','ollama'].includes(id)}
