export type PluginId = 'github' | 'vercel' | 'netlify' | 'custom';

export type PluginConfig = {
  id: PluginId;
  name: string;
  description: string;
  enabled: boolean;
  token?: string;
  options?: Record<string, string>;
};

export type PublishResult = {
  success: boolean;
  url?: string;
  repo?: string;
  message: string;
  error?: string;
};

const STORAGE_KEY = 'mico-plugins:v1';

export const defaultPluginConfigs: Record<PluginId, PluginConfig> = {
  github: {
    id: 'github',
    name: 'GitHub',
    description: 'Publish your project to a new or existing GitHub repository with automatic commits.',
    enabled: true,
    token: '',
    options: {
      repo: '',
      isPrivate: 'false',
      branch: 'main',
      message: 'Update from MicoCode',
    },
  },
  vercel: {
    id: 'vercel',
    name: 'Vercel',
    description: 'Instant zero-configuration deployment for static websites with a public .vercel.app URL.',
    enabled: true,
    token: '',
    options: {
      projectName: '',
    },
  },
  netlify: {
    id: 'netlify',
    name: 'Netlify',
    description: 'Deploy static sites directly to Netlify’s global edge network with a .netlify.app URL.',
    enabled: true,
    token: '',
    options: {
      siteName: '',
    },
  },
  custom: {
    id: 'custom',
    name: 'Custom Webhook',
    description: 'POST project files as JSON or ZIP payload to any custom deployment webhook or server.',
    enabled: false,
    token: '',
    options: {
      endpoint: '',
      authHeader: '',
    },
  },
};

export function loadPluginConfigs(): Record<PluginId, PluginConfig> {
  if (typeof window === 'undefined') return defaultPluginConfigs;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPluginConfigs;
    const parsed = JSON.parse(raw);
    const result = { ...defaultPluginConfigs };
    for (const key of Object.keys(defaultPluginConfigs) as PluginId[]) {
      if (parsed[key]) {
        result[key] = {
          ...defaultPluginConfigs[key],
          ...parsed[key],
          options: {
            ...defaultPluginConfigs[key].options,
            ...(parsed[key].options || {}),
          },
        };
      }
      // Also restore token if stored in sessionStorage for extra security
      const sessionToken = sessionStorage.getItem(`mico-plugin-token:${key}`);
      if (sessionToken) {
        result[key].token = sessionToken;
      }
    }
    return result;
  } catch {
    return defaultPluginConfigs;
  }
}

export function savePluginConfigs(configs: Record<PluginId, PluginConfig>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
    for (const [key, cfg] of Object.entries(configs) as [PluginId, PluginConfig][]) {
      if (cfg.token) {
        sessionStorage.setItem(`mico-plugin-token:${key}`, cfg.token);
      } else {
        sessionStorage.removeItem(`mico-plugin-token:${key}`);
      }
    }
  } catch {
    // Storage quota or disabled
  }
}

export function getPluginToken(id: PluginId): string {
  if (typeof window === 'undefined') return '';
  const fromSession = sessionStorage.getItem(`mico-plugin-token:${id}`);
  if (fromSession) return fromSession;
  const configs = loadPluginConfigs();
  return configs[id]?.token || '';
}

/**
 * Publish files to GitHub using the GitHub REST and Git Data APIs.
 */
export async function publishToGitHub(params: {
  files: Record<string, string>;
  projectName: string;
  token?: string;
  repo?: string;
  message?: string;
  isPrivate?: boolean;
}): Promise<PublishResult> {
  const token = (params.token || getPluginToken('github')).trim();
  if (!token) {
    return {
      success: false,
      message: 'GitHub Personal Access Token is required. Please set it in the Plugins dialog.',
      error: 'NO_TOKEN',
    };
  }

  const cleanName = (params.repo || params.projectName || 'micocode-project')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'micocode-project';

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  try {
    // 1. Get authenticated user
    const userRes = await fetch('https://api.github.com/user', { headers: authHeaders });
    if (!userRes.ok) {
      if (userRes.status === 401) throw new Error('Invalid GitHub token. Check your token in Plugins.');
      throw new Error(`GitHub user request returned status ${userRes.status}.`);
    }
    const userData = await userRes.json();
    const username = userData.login;
    const repoFullName = `${username}/${cleanName}`;

    // 2. Check if repository exists, or create it
    let repoRes = await fetch(`https://api.github.com/repos/${repoFullName}`, { headers: authHeaders });
    if (repoRes.status === 404) {
      const createRes = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName,
          description: 'Built with MicoCode',
          private: params.isPrivate === true,
          auto_init: true, // create initial commit so refs/heads/main exists
        }),
      });
      if (!createRes.ok) {
        const errData = await createRes.json().catch(() => ({}));
        throw new Error(errData.message || `Failed to create repository ${cleanName} (${createRes.status})`);
      }
      repoRes = createRes;
      // Brief pause to allow GitHub to initialize default branch
      await new Promise(r => setTimeout(r, 1200));
    } else if (!repoRes.ok) {
      const errData = await repoRes.json().catch(() => ({}));
      throw new Error(errData.message || `Failed to access repository ${repoFullName} (${repoRes.status})`);
    }

    // 3. Get the latest commit SHA for 'main' (or fallback to 'master')
    let branch = 'main';
    let refRes = await fetch(`https://api.github.com/repos/${repoFullName}/git/ref/heads/main`, { headers: authHeaders });
    if (refRes.status === 404) {
      branch = 'master';
      refRes = await fetch(`https://api.github.com/repos/${repoFullName}/git/ref/heads/master`, { headers: authHeaders });
    }

    let parentCommitSha: string | null = null;
    let baseTreeSha: string | null = null;
    if (refRes.ok) {
      const refData = await refRes.json();
      parentCommitSha = refData.object.sha;
      const commitRes = await fetch(`https://api.github.com/repos/${repoFullName}/git/commits/${parentCommitSha}`, { headers: authHeaders });
      if (commitRes.ok) {
        const commitData = await commitRes.json();
        baseTreeSha = commitData.tree.sha;
      }
    }

    // 4. Create blobs for each file
    const treeEntries = [];
    for (const [filePath, content] of Object.entries(params.files)) {
      if (!content && content !== '') continue;
      const blobRes = await fetch(`https://api.github.com/repos/${repoFullName}/git/blobs`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          encoding: 'utf-8',
        }),
      });
      if (!blobRes.ok) {
        throw new Error(`Failed to upload file ${filePath} to GitHub.`);
      }
      const blobData = await blobRes.json();
      treeEntries.push({
        path: filePath.replace(/^\/+/, ''),
        mode: '100644',
        type: 'blob',
        sha: blobData.sha,
      });
    }

    // 5. Create git tree
    const treePayload: Record<string, unknown> = { tree: treeEntries };
    if (baseTreeSha) treePayload.base_tree = baseTreeSha;

    const treeRes = await fetch(`https://api.github.com/repos/${repoFullName}/git/trees`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(treePayload),
    });
    if (!treeRes.ok) {
      const err = await treeRes.json().catch(() => ({}));
      throw new Error(`Failed to create Git tree: ${err.message || treeRes.status}`);
    }
    const treeData = await treeRes.json();

    // 6. Create commit
    const commitMessage = params.message || `Publish from MicoCode - ${new Date().toLocaleString()}`;
    const commitPayload: Record<string, unknown> = {
      message: commitMessage,
      tree: treeData.sha,
      parents: parentCommitSha ? [parentCommitSha] : [],
    };
    const newCommitRes = await fetch(`https://api.github.com/repos/${repoFullName}/git/commits`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(commitPayload),
    });
    if (!newCommitRes.ok) {
      const err = await newCommitRes.json().catch(() => ({}));
      throw new Error(`Failed to create commit: ${err.message || newCommitRes.status}`);
    }
    const newCommitData = await newCommitRes.json();

    // 7. Update branch ref
    if (parentCommitSha) {
      await fetch(`https://api.github.com/repos/${repoFullName}/git/refs/heads/${branch}`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sha: newCommitData.sha,
          force: true,
        }),
      });
    } else {
      await fetch(`https://api.github.com/repos/${repoFullName}/git/refs`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref: `refs/heads/${branch}`,
          sha: newCommitData.sha,
        }),
      });
    }

    const repoUrl = `https://github.com/${repoFullName}`;
    return {
      success: true,
      url: repoUrl,
      repo: repoFullName,
      message: `Project published to GitHub: ${repoUrl}`,
    };
  } catch (err) {
    return {
      success: false,
      message: (err as Error).message || 'Failed to publish to GitHub.',
      error: (err as Error).message,
    };
  }
}

/**
 * Publish static site directly to Vercel via Vercel deployments API v13.
 */
export async function publishToVercel(params: {
  files: Record<string, string>;
  projectName: string;
  token?: string;
}): Promise<PublishResult> {
  const token = (params.token || getPluginToken('vercel')).trim();
  if (!token) {
    return {
      success: false,
      message: 'Vercel API token is required. Please set it in the Plugins dialog.',
      error: 'NO_TOKEN',
    };
  }

  const name = (params.projectName || 'micocode-site')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'micocode-site';

  const filePayload = Object.entries(params.files).map(([file, data]) => ({
    file: file.replace(/^\/+/, ''),
    data,
  }));

  try {
    const res = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        files: filePayload,
        projectSettings: {
          framework: null,
        },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || data.message || `Vercel deployment failed with status ${res.status}.`);
    }

    const deployUrl = data.url ? (data.url.startsWith('http') ? data.url : `https://${data.url}`) : '';
    const aliasUrl = data.alias && data.alias[0] ? `https://${data.alias[0]}` : deployUrl;

    return {
      success: true,
      url: aliasUrl || deployUrl,
      message: `Website deployed to Vercel: ${aliasUrl || deployUrl}`,
    };
  } catch (err) {
    return {
      success: false,
      message: (err as Error).message || 'Failed to deploy to Vercel.',
      error: (err as Error).message,
    };
  }
}

/**
 * Publish static site directly to Netlify using the Netlify API.
 */
export async function publishToNetlify(params: {
  files: Record<string, string>;
  siteName?: string;
  token?: string;
}): Promise<PublishResult> {
  const token = (params.token || getPluginToken('netlify')).trim();
  if (!token) {
    return {
      success: false,
      message: 'Netlify Personal Access Token is required. Please set it in the Plugins dialog.',
      error: 'NO_TOKEN',
    };
  }

  try {
    // 1. Create a zip of all project files
    const {default: JSZip} = await import('jszip');
    const zip = new JSZip();
    for (const [file, content] of Object.entries(params.files)) {
      zip.file(file.replace(/^\/+/, ''), content);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });

    // 2. Create or deploy to Netlify site
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/zip',
    };

    const siteName = params.siteName ? params.siteName.toLowerCase().replace(/[^a-z0-9-]/g, '-') : undefined;
    const url = siteName
      ? `https://api.netlify.com/api/v1/sites`
      : 'https://api.netlify.com/api/v1/sites';

    const deployRes = await fetch(url, {
      method: 'POST',
      headers,
      body: zipBlob,
    });

    const data = await deployRes.json();
    if (!deployRes.ok) {
      throw new Error(data.message || `Netlify deployment failed with status ${deployRes.status}.`);
    }

    const siteUrl = data.ssl_url || data.url || (data.subdomain ? `https://${data.subdomain}.netlify.app` : '');
    return {
      success: true,
      url: siteUrl,
      message: `Website deployed to Netlify: ${siteUrl}`,
    };
  } catch (err) {
    return {
      success: false,
      message: (err as Error).message || 'Failed to deploy to Netlify.',
      error: (err as Error).message,
    };
  }
}

/**
 * Universal publisher dispatcher for agent actions and UI triggers.
 */
export async function executePublish(params: {
  target: PluginId;
  files: Record<string, string>;
  projectName: string;
  message?: string;
  repo?: string;
  token?: string;
  isPrivate?: boolean;
}): Promise<PublishResult> {
  const target = params.target || 'github';

  if (target === 'github') {
    return publishToGitHub({
      files: params.files,
      projectName: params.projectName,
      token: params.token,
      repo: params.repo,
      message: params.message,
      isPrivate: params.isPrivate,
    });
  }

  if (target === 'vercel') {
    return publishToVercel({
      files: params.files,
      projectName: params.projectName,
      token: params.token,
    });
  }

  if (target === 'netlify') {
    return publishToNetlify({
      files: params.files,
      siteName: params.projectName,
      token: params.token,
    });
  }

  if (target === 'custom') {
    const configs = loadPluginConfigs();
    const endpoint = configs.custom?.options?.endpoint;
    if (!endpoint) {
      return {
        success: false,
        message: 'Custom Webhook endpoint URL is not configured in Plugins.',
        error: 'NO_ENDPOINT',
      };
    }
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (configs.custom?.options?.authHeader) {
        headers['Authorization'] = configs.custom.options.authHeader;
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: params.projectName,
          files: params.files,
          timestamp: Date.now(),
        }),
      });
      if (!res.ok) throw new Error(`Custom webhook returned ${res.status}`);
      return {
        success: true,
        message: `Project payload sent to custom webhook: ${endpoint}`,
      };
    } catch (e) {
      return {
        success: false,
        message: (e as Error).message,
        error: (e as Error).message,
      };
    }
  }

  return {
    success: false,
    message: `Unknown publish target: ${target}`,
    error: 'UNKNOWN_TARGET',
  };
}
