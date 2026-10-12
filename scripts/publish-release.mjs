import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = execSync('git credential fill', {input: 'protocol=https\nhost=github.com\n\n'}).toString();
const token = out.split('\n').find(l => l.startsWith('password='))?.slice(9).trim();

if (!token) {
  console.error('Could not find GitHub token in git credential manager.');
  process.exit(1);
}

const tag = 'v0.7.8';
const name = 'MicoCode 0.7.8 — 9Router Cascade Fallback, Live Console & Inspector';
const checksums = fs.readFileSync('release/SHA256SUMS.txt', 'utf8').trim();

const body = `## MicoCode v0.7.8 — 9Router Cascade Fallback, Live Preview Console, Element Inspector & Google AI Studio

### What's New in v0.7.8
- **Resilient 9Router & Proxy Cascade Fallback**: 9Router, LiteLLM, CLIProxy, and custom OpenAI-compatible proxies now seamlessly cascade across all configured cloud providers (OpenCode Zen → AIHubMix → Google AI Studio → NVIDIA NIM → OpenRouter) and local Ollama (\`gemma4:gpu\`) when upstream credits or quotas are exhausted or connection drops occur.
- **Enhanced Reachability Diagnostics & Mixed Content Detection**: Transparent diagnostic reporting that surfaces underlying system error codes (\`ECONNREFUSED\`, network drops) and explicitly alerts if a web browser on HTTPS is blocked from connecting to local HTTP routers.
- **Recoverable Router Error Recognition**: Router reachability and connection errors now trigger automatic multi-provider failover instead of halting execution.
- **Point-and-Prompt Visual Element Inspector**: Hover over any element in the live preview to inspect its bounding box, CSS classes, and dimensions, then click to prefill Mico's prompt with full element context.
- **Live Preview Console & Error HUD**: Real-time console logs, error counter badge, and one-click "Fix with Mico" button for instant diagnosis and repair.
- **First-Class Provider Integrations**: Google AI Studio (Gemini 2.5 Pro & Flash, Gemma) and AIHubMix multi-provider routing (Claude, GPT-4o, DeepSeek).

### Checksums
\`\`\`
${checksums}
\`\`\`
`;

async function publish() {
  console.log('Creating release for', tag);
  // Check if release already exists
  const listRes = await fetch('https://api.github.com/repos/ahpah-dev/MicoCode/releases', {
    headers: {
      'Authorization': 'Bearer ' + token,
      'User-Agent': 'MicoCode-Release-Script',
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  const releases = await listRes.json();
  let release = releases.find(r => r.tag_name === tag);

  if (!release) {
    const createRes = await fetch('https://api.github.com/repos/ahpah-dev/MicoCode/releases', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'User-Agent': 'MicoCode-Release-Script',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: 'main',
        name,
        body,
        draft: false,
        prerelease: false
      })
    });
    release = await createRes.json();
    if (!createRes.ok) {
      console.error('Failed to create release:', createRes.status, release);
      process.exit(1);
    }
    console.log('Release created! ID:', release.id);
  } else {
    console.log('Release already exists. ID:', release.id);
  }

  // Upload assets
  const filesToUpload = [
    {path: 'release/MicoCode-Setup-0.7.8-x64.exe', name: 'MicoCode-Setup-0.7.8-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
    {path: 'release/MicoCode-Portable-0.7.8-x64.exe', name: 'MicoCode-Portable-0.7.8-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
    {path: 'release/SHA256SUMS.txt', name: 'SHA256SUMS.txt', contentType: 'text/plain'}
  ];

  for (const item of filesToUpload) {
    const existingAsset = release.assets?.find(a => a.name === item.name);
    if (existingAsset) {
      console.log(`Deleting existing asset ${item.name}...`);
      await fetch(`https://api.github.com/repos/ahpah-dev/MicoCode/releases/assets/${existingAsset.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer ' + token,
          'User-Agent': 'MicoCode-Release-Script'
        }
      });
    }

    console.log(`Uploading ${item.name} (${(fs.statSync(item.path).size / 1024 / 1024).toFixed(1)} MB)...`);
    const fileData = fs.readFileSync(item.path);
    const uploadUrl = `https://uploads.github.com/repos/ahpah-dev/MicoCode/releases/${release.id}/assets?name=${encodeURIComponent(item.name)}`;
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'User-Agent': 'MicoCode-Release-Script',
        'Content-Type': item.contentType,
        'Content-Length': String(fileData.length)
      },
      body: fileData
    });
    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      console.error(`Failed to upload ${item.name}:`, uploadRes.status, err);
    } else {
      console.log(`Uploaded ${item.name} successfully!`);
    }
  }

  console.log('All assets uploaded! Release URL:', release.html_url);
}

publish().catch(console.error);
