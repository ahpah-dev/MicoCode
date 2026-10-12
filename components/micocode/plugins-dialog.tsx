'use client';
import {useState} from 'react';
import {Modal} from './primitives';
import {Dropdown} from './dropdown';
import {Blocks,Check,ExternalLink,LoaderCircle,Lock,ShieldCheck,Sparkles,Upload,Globe,Zap,ArrowUpRight,Eye,EyeOff,RefreshCw} from 'lucide-react';
import {executePublish,loadPluginConfigs,savePluginConfigs,type PluginConfig,type PluginId,type PublishResult} from '@/lib/mico/plugins';
import type {Project} from '@/lib/mico/types';

type Props = {
  project: Project;
  onClose: () => void;
  onNotify: (msg: string) => void;
  initialPlugin?: PluginId;
};

export function PluginsDialog({project, onClose, onNotify, initialPlugin = 'github'}: Props) {
  const [configs, setConfigs] = useState<Record<PluginId, PluginConfig>>(() => loadPluginConfigs());
  const [activeTab, setActiveTab] = useState<PluginId>(initialPlugin);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [showToken, setShowToken] = useState(false);

  const activeConfig = configs[activeTab];

  function updateConfig(patch: Partial<PluginConfig>, optionsPatch?: Record<string, string>) {
    const updated = {
      ...configs,
      [activeTab]: {
        ...configs[activeTab],
        ...patch,
        options: {
          ...configs[activeTab].options,
          ...(optionsPatch || {}),
        },
      },
    };
    setConfigs(updated);
    savePluginConfigs(updated);
  }

  async function handlePublish() {
    setPublishing(true);
    setPublishResult(null);

    const token = activeConfig.token?.trim();
    if (!token && activeTab !== 'custom') {
      setPublishing(false);
      const msg = `Please enter your ${activeConfig.name} access token first.`;
      setPublishResult({success: false, message: msg, error: 'NO_TOKEN'});
      onNotify(msg);
      return;
    }

    try {
      const repoName = activeConfig.options?.repo || project.name;
      const isPrivate = activeConfig.options?.isPrivate === 'true';
      const commitMsg = activeConfig.options?.message || `Update from MicoCode - ${new Date().toLocaleDateString()}`;

      const res = await executePublish({
        target: activeTab,
        files: project.files,
        projectName: project.name,
        repo: repoName,
        message: commitMsg,
        token: activeConfig.token,
        isPrivate,
      });

      setPublishResult(res);
      if (res.success) {
        onNotify(res.message);
      } else {
        onNotify(res.message || 'Publishing failed. Check your token and permissions.');
      }
    } catch (e) {
      const msg = (e as Error).message || 'Publishing failed.';
      setPublishResult({success: false, message: msg, error: msg});
      onNotify(msg);
    } finally {
      setPublishing(false);
    }
  }

  const hasToken = !!activeConfig.token?.trim();

  return (
    <Modal
      title="Plugins & Publishing"
      subtitle="Connect services to publish code to GitHub, deploy to Vercel, or push via webhooks — with one click or via AI agent prompt."
      onClose={onClose}
      wide
    >
      <div className="plugins-container">
        {/* Tab navigation */}
        <div className="plugins-tabs" role="tablist">
          {(['github', 'vercel', 'netlify', 'custom'] as const).map(id => {
            const cfg = configs[id];
            const isConnected = !!cfg.token?.trim() || (id === 'custom' && !!cfg.options?.endpoint);
            return (
              <button
                key={id}
                role="tab"
                aria-selected={activeTab === id}
                className={`plugin-tab ${activeTab === id ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab(id);
                  setPublishResult(null);
                }}
              >
                <div className="plugin-tab-icon">
                  {id === 'github' ? <Blocks size={17} /> : id === 'vercel' ? <Zap size={17} /> : id === 'netlify' ? <Globe size={17} /> : <RefreshCw size={17} />}
                </div>
                <div className="plugin-tab-info">
                  <strong>{cfg.name}</strong>
                  <span className={`plugin-status-badge ${isConnected ? 'connected' : ''}`}>
                    {isConnected ? 'Connected' : 'Setup needed'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="plugin-content">
          <div className="plugin-header">
            <div>
              <h3>{activeConfig.name} Publisher</h3>
              <p className="plugin-desc">{activeConfig.description}</p>
            </div>
            {hasToken && (
              <span className="badge-verified">
                <Check size={12} /> Ready to publish
              </span>
            )}
          </div>

          <div className="plugin-fields">
            {activeTab === 'github' && (
              <>
                <label>
                  <span>GitHub Personal Access Token (classic or fine-grained)</span>
                  <div className="token-input-wrap">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={activeConfig.token || ''}
                      onChange={e => updateConfig({token: e.target.value})}
                      placeholder="ghp_… or github_pat_…"
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="icon-button token-eye"
                      onClick={() => setShowToken(!showToken)}
                      title={showToken ? 'Hide token' : 'Show token'}
                      aria-label={showToken ? 'Hide the token' : 'Show the token'}
                    >
                      {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <small className="field-help">
                    Stored in your browser session. Needs <code>repo</code> scope to create or update repositories.{' '}
                    <a
                      href="https://github.com/settings/tokens/new?description=MicoCode&scopes=repo"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Generate GitHub token <ArrowUpRight size={11} />
                    </a>
                  </small>
                </label>

                <div className="two-fields">
                  <label>
                    <span>Repository name</span>
                    <input
                      value={activeConfig.options?.repo ?? project.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}
                      onChange={e => updateConfig({}, {repo: e.target.value})}
                      placeholder={project.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}
                    />
                  </label>
                  <label>
                    <span>Visibility</span>
                    <Dropdown
                      label="Visibility"
                      value={activeConfig.options?.isPrivate || 'false'}
                      onChange={value => updateConfig({}, {isPrivate: value})}
                      options={[
                        {value: 'false', label: 'Public repository'},
                        {value: 'true', label: 'Private repository'},
                      ]}
                    />
                  </label>
                </div>

                <label>
                  <span>Commit message</span>
                  <input
                    value={activeConfig.options?.message || 'Publish from MicoCode'}
                    onChange={e => updateConfig({}, {message: e.target.value})}
                    placeholder="Publish from MicoCode"
                  />
                </label>
              </>
            )}

            {activeTab === 'vercel' && (
              <>
                <label>
                  <span>Vercel Access Token</span>
                  <div className="token-input-wrap">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={activeConfig.token || ''}
                      onChange={e => updateConfig({token: e.target.value})}
                      placeholder="Enter Vercel Token"
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="icon-button token-eye"
                      onClick={() => setShowToken(!showToken)}
                      title={showToken ? 'Hide token' : 'Show token'}
                      aria-label={showToken ? 'Hide the token' : 'Show the token'}
                    >
                      {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <small className="field-help">
                    Allows zero-configuration deployment to Vercel edge infrastructure.{' '}
                    <a href="https://vercel.com/account/tokens" target="_blank" rel="noreferrer">
                      Get a Vercel token <ArrowUpRight size={11} />
                    </a>
                  </small>
                </label>

                <label>
                  <span>Project name on Vercel</span>
                  <input
                    value={activeConfig.options?.projectName ?? project.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}
                    onChange={e => updateConfig({}, {projectName: e.target.value})}
                    placeholder={project.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}
                  />
                </label>
              </>
            )}

            {activeTab === 'netlify' && (
              <>
                <label>
                  <span>Netlify Personal Access Token</span>
                  <div className="token-input-wrap">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={activeConfig.token || ''}
                      onChange={e => updateConfig({token: e.target.value})}
                      placeholder="Enter Netlify Token"
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="icon-button token-eye"
                      onClick={() => setShowToken(!showToken)}
                      title={showToken ? 'Hide token' : 'Show token'}
                      aria-label={showToken ? 'Hide the token' : 'Show the token'}
                    >
                      {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <small className="field-help">
                    Deploys site zip directly to Netlify global CDN.{' '}
                    <a
                      href="https://app.netlify.com/user/applications#personal-access-tokens"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Get Netlify token <ArrowUpRight size={11} />
                    </a>
                  </small>
                </label>

                <label>
                  <span>Site name (optional)</span>
                  <input
                    value={activeConfig.options?.siteName || ''}
                    onChange={e => updateConfig({}, {siteName: e.target.value})}
                    placeholder="Leave blank for an auto-generated subdomain"
                  />
                </label>
              </>
            )}

            {activeTab === 'custom' && (
              <>
                <label>
                  <span>Webhook endpoint URL</span>
                  <input
                    value={activeConfig.options?.endpoint || ''}
                    onChange={e => updateConfig({}, {endpoint: e.target.value})}
                    placeholder="https://api.your-service.com/deploy"
                  />
                  <small className="field-help">Receives a JSON payload with project name and file contents.</small>
                </label>

                <label>
                  <span>Authorization Header (optional)</span>
                  <input
                    type="password"
                    value={activeConfig.options?.authHeader || ''}
                    onChange={e => updateConfig({}, {authHeader: e.target.value})}
                    placeholder="Bearer secret-token-here"
                  />
                </label>
              </>
            )}
          </div>

          {/* AI Agent Publishing Hint */}
          <div className="agent-publish-tip">
            <Sparkles size={16} />
            <div>
              <strong>AI Agent Publishing</strong>
              <p>
                When your tokens are configured, you can simply ask Mico in chat:{' '}
                <em>“Publish this website to {activeConfig.name}”</em> and Mico will run the deployment and return your live URL.
              </p>
            </div>
          </div>

          {/* Result card */}
          {publishResult && (
            <div className={`publish-result-card ${publishResult.success ? 'success' : 'error'}`}>
              <div className="result-header">
                {publishResult.success ? <Check size={16} /> : <Lock size={16} />}
                <strong>{publishResult.success ? 'Published successfully!' : 'Publishing failed'}</strong>
              </div>
              <p>{publishResult.message}</p>
              {publishResult.url && (
                <a className="publish-link" href={publishResult.url} target="_blank" rel="noreferrer">
                  <span>Open published site / repo</span>
                  <ExternalLink size={13} />
                </a>
              )}
            </div>
          )}

          {/* Modal Actions */}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose} disabled={publishing}>
              Close
            </button>
            <button
              type="button"
              className="primary"
              onClick={handlePublish}
              disabled={publishing || (!hasToken && activeTab !== 'custom')}
            >
              {publishing ? (
                <>
                  <LoaderCircle size={15} className="spin" />
                  <span>Publishing…</span>
                </>
              ) : (
                <>
                  <Upload size={14} />
                  <span>Publish to {activeConfig.name}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
