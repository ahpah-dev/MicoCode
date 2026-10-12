'use client';
import {useEffect,useState,useCallback} from 'react';
import {
  GitBranch,GitCommit,GitPullRequest,RefreshCw,ArrowUp,ArrowDown,
  Plus,FolderGit2,Check,AlertCircle,ExternalLink,FolderOpen,Blocks,History
} from 'lucide-react';
import type {GitStatusResult,GitLogItem} from '@/lib/mico/desktop';

type Props = {
  sourceFolder?: string;
  onOpenFolder: () => void;
  onOpenPlugins: () => void;
  onOpenHistory: () => void;
  onNotify: (msg: string) => void;
  onSelectFile?: (path: string) => void;
};

export function GitPanel({sourceFolder,onOpenFolder,onOpenPlugins,onOpenHistory,onNotify,onSelectFile}:Props){
  const desktop = typeof window !== 'undefined' ? window.micoDesktop : undefined;
  const [gitAvailable,setGitAvailable] = useState<boolean|null>(null);
  const [status,setStatus] = useState<GitStatusResult|null>(null);
  const [logs,setLogs] = useState<GitLogItem[]>([]);
  const [loading,setLoading] = useState(false);
  const [commitMsg,setCommitMsg] = useState('');
  const [committing,setCommitting] = useState(false);
  const [pushing,setPushing] = useState(false);
  const [pulling,setPulling] = useState(false);
  const [activeTab,setActiveTab] = useState<'changes'|'history'>('changes');

  const refresh = useCallback(async () => {
    if (!desktop?.git || !sourceFolder) return;
    setLoading(true);
    try {
      const avail = await desktop.git.isAvailable();
      setGitAvailable(avail);
      if (!avail) return;
      const res = await desktop.git.status(sourceFolder);
      setStatus(res);
      if (res.isRepo) {
        const history = await desktop.git.log(sourceFolder, 15);
        setLogs(history);
      } else {
        setLogs([]);
      }
    } catch (e) {
      onNotify('Git check failed: ' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [desktop, sourceFolder, onNotify]);

  useEffect(() => {
    if (desktop?.git && sourceFolder) {
      void refresh();
    }
  }, [desktop, sourceFolder, refresh]);

  async function handleInit() {
    if (!desktop?.git || !sourceFolder) return;
    setLoading(true);
    try {
      await desktop.git.init(sourceFolder);
      onNotify('Initialized new Git repository.');
      await refresh();
    } catch (e) {
      onNotify('Git init failed: ' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!desktop?.git || !sourceFolder || !commitMsg.trim()) return;
    setCommitting(true);
    try {
      const res = await desktop.git.commit(sourceFolder, commitMsg.trim());
      onNotify('Committed: ' + commitMsg.trim());
      setCommitMsg('');
      await refresh();
    } catch (e) {
      onNotify('Git commit failed: ' + (e as Error).message);
    } finally {
      setCommitting(false);
    }
  }

  async function handlePush() {
    if (!desktop?.git || !sourceFolder) return;
    setPushing(true);
    try {
      const res = await desktop.git.push(sourceFolder);
      onNotify('Pushed to remote repository.');
      await refresh();
    } catch (e) {
      onNotify('Git push failed: ' + (e as Error).message);
    } finally {
      setPushing(false);
    }
  }

  async function handlePull() {
    if (!desktop?.git || !sourceFolder) return;
    setPulling(true);
    try {
      const res = await desktop.git.pull(sourceFolder);
      onNotify('Pulled latest changes from remote.');
      await refresh();
    } catch (e) {
      onNotify('Git pull failed: ' + (e as Error).message);
    } finally {
      setPulling(false);
    }
  }

  // Fallback view for Web or when no desktop folder is linked
  if (!desktop || !sourceFolder) {
    return (
      <div className="git-panel">
        <div className="git-section-header">
          <GitBranch size={16} />
          <strong>Source Control</strong>
        </div>
        <div className="git-web-banner">
          <FolderGit2 size={24} className="muted" />
          <h4>Native Git Integration</h4>
          <p>
            {desktop
              ? 'Open a local folder in MicoCode to use native Git operations: staging, branches, commits, push, and pull.'
              : 'Working in the browser? You can publish directly to GitHub, or use the Windows app to connect local Git repos.'}
          </p>
          <div className="git-web-actions">
            {desktop && (
              <button className="primary" onClick={onOpenFolder}>
                <FolderOpen size={14} /> Open project folder
              </button>
            )}
            <button className="secondary" onClick={onOpenPlugins}>
              <Blocks size={14} /> GitHub Plugin (Push & Sync)
            </button>
            <button className="secondary" onClick={onOpenHistory}>
              <History size={14} /> Version Checkpoints
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (gitAvailable === false) {
    return (
      <div className="git-panel">
        <div className="git-section-header">
          <AlertCircle size={16} />
          <strong>Git Not Found</strong>
        </div>
        <div className="git-not-repo">
          <p>Git was not detected on your system PATH. Install Git for Windows to enable native version control.</p>
          <a
            href="https://git-scm.com/download/win"
            target="_blank"
            rel="noreferrer"
            className="button outline"
          >
            Download Git for Windows <ExternalLink size={12} />
          </a>
        </div>
      </div>
    );
  }

  if (status && !status.isRepo) {
    return (
      <div className="git-panel">
        <div className="git-section-header">
          <GitBranch size={16} />
          <strong>Source Control</strong>
          <button className="icon-button" title="Refresh" aria-label="Refresh git status" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
        </div>
        <div className="git-not-repo">
          <FolderGit2 size={28} className="muted" />
          <h4>Not a Git repository</h4>
          <p>This folder is not yet tracked with Git. Initialize a repository to start tracking your changes.</p>
          <button className="primary" onClick={() => void handleInit()} disabled={loading}>
            <Plus size={14} /> Initialize Git Repository
          </button>
        </div>
      </div>
    );
  }

  const changeCount = (status?.modified?.length || 0) + (status?.untracked?.length || 0) + (status?.staged?.length || 0);

  return (
    <div className="git-panel">
      <div className="git-section-header">
        <div className="git-branch-badge" title={`Current branch: ${status?.branch || 'main'}`}>
          <GitBranch size={14} />
          <span>{status?.branch || 'main'}</span>
          {status?.tracking && (
            <small className="git-tracking">
              {status.ahead > 0 && <span title={`${status.ahead} commit(s) ahead`}><ArrowUp size={10} />{status.ahead}</span>}
              {status.behind > 0 && <span title={`${status.behind} commit(s) behind`}><ArrowDown size={10} />{status.behind}</span>}
            </small>
          )}
        </div>
        <div className="git-header-actions">
          <button className="icon-button" title="Pull from remote" aria-label="Pull from remote" onClick={() => void handlePull()} disabled={pulling || loading}>
            <ArrowDown size={13} className={pulling ? 'spin' : ''} />
          </button>
          <button className="icon-button" title="Push to remote" aria-label="Push to remote" onClick={() => void handlePush()} disabled={pushing || loading}>
            <ArrowUp size={13} className={pushing ? 'spin' : ''} />
          </button>
          <button className="icon-button" title="Refresh git status" aria-label="Refresh git status" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <div className="git-commit-form">
        <textarea
          rows={2}
          value={commitMsg}
          onChange={e => setCommitMsg(e.target.value)}
          onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              void handleCommit();
            }
          }}
          placeholder="Message (Ctrl+Enter to commit)"
          disabled={committing || loading}
        />
        <button
          className="primary git-commit-btn"
          onClick={() => void handleCommit()}
          disabled={committing || loading || changeCount === 0 || !commitMsg.trim()}
        >
          <GitCommit size={14} /> {committing ? 'Committing…' : 'Commit changes'}
        </button>
      </div>

      <div className="git-tabs">
        <button
          className={'git-tab ' + (activeTab === 'changes' ? 'active' : '')}
          onClick={() => setActiveTab('changes')}
        >
          Changes <span className="git-badge">{changeCount}</span>
        </button>
        <button
          className={'git-tab ' + (activeTab === 'history' ? 'active' : '')}
          onClick={() => setActiveTab('history')}
        >
          History <span className="git-badge">{logs.length}</span>
        </button>
      </div>

      {activeTab === 'changes' ? (
        <div className="git-changes-list">
          {changeCount === 0 ? (
            <div className="git-clean-msg">
              <Check size={16} /> Working tree clean
            </div>
          ) : (
            <>
              {status?.staged && status.staged.length > 0 && (
                <div className="git-group">
                  <span className="git-group-title">Staged Changes ({status.staged.length})</span>
                  {status.staged.map(s => (
                    <button
                      key={s.file}
                      type="button"
                      className="git-file-row"
                      onClick={() => onSelectFile?.(s.file)}
                    >
                      <span className="git-status-tag tag-staged">{s.status}</span>
                      <span className="git-file-path">{s.file}</span>
                    </button>
                  ))}
                </div>
              )}
              {status?.modified && status.modified.length > 0 && (
                <div className="git-group">
                  <span className="git-group-title">Modified ({status.modified.length})</span>
                  {status.modified.map(m => (
                    <button
                      key={m.file}
                      type="button"
                      className="git-file-row"
                      onClick={() => onSelectFile?.(m.file)}
                    >
                      <span className="git-status-tag tag-modified">{m.status}</span>
                      <span className="git-file-path">{m.file}</span>
                    </button>
                  ))}
                </div>
              )}
              {status?.untracked && status.untracked.length > 0 && (
                <div className="git-group">
                  <span className="git-group-title">Untracked ({status.untracked.length})</span>
                  {status.untracked.map(u => (
                    <button
                      key={u}
                      type="button"
                      className="git-file-row"
                      onClick={() => onSelectFile?.(u)}
                    >
                      <span className="git-status-tag tag-untracked">?</span>
                      <span className="git-file-path">{u}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="git-history-list">
          {logs.length === 0 ? (
            <p className="muted pad-12">No commits recorded yet.</p>
          ) : (
            logs.map(log => (
              <div key={log.hash} className="git-log-item">
                <div className="git-log-header">
                  <span className="git-hash" title={log.hash}>{log.shortHash}</span>
                  <span className="git-author">{log.author}</span>
                  <small className="git-date">{log.date}</small>
                </div>
                <div className="git-log-msg">{log.message}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
