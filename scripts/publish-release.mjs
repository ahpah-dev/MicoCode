import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = execSync('git credential fill', {input: 'protocol=https\nhost=github.com\n\n'}).toString();
const token = out.split('\n').find(l => l.startsWith('password='))?.slice(9).trim();

if (!token) {
  console.error('Could not find GitHub token in git credential manager.');
  process.exit(1);
}

const tag = 'v0.8.5';
const name = 'MicoCode 0.8.5 — Octopus Removed';
const checksums = fs.readFileSync('release/SHA256SUMS.txt', 'utf8').trim();

const body = `## MicoCode v0.8.5 — Octopus Removed

### Octopus is gone
It was the least-used project of everything considered — 2,702 GitHub stars against
LiteLLM's 61,082 — and it never ran reliably here. Rather than leave a router in the
list that answers with errors, it has been removed outright: installer, pinned
artifact, admin-API client, dashboard entry, card and settings.

Its 51 MB install is left behind in \`%APPDATA%\\MicoCode\\providers\\octopus\`. Nothing
uses it now, so it can be deleted.

### The rest of the list is unchanged
**9Router, LiteLLM, CLIProxyAPI and FreeRide** still install, start and key themselves,
and **Ollama** still runs models on your own machine. The accepted-installer test now
asserts \`octopus\` is *rejected*, so it cannot return by accident.

### What I evaluated as its replacement
**OmniRoute** (\`diegosouzapw/OmniRoute\`, MIT, **75,693 stars**, actively maintained)
installs over npm with the Node runtime MicoCode already bundles, and
\`omniroute serve --daemon --port N --no-open\` starts headlessly and binds loopback.
**It is not in this release** because I could not get past its own authentication:
\`/v1/models\` answers \`Authentication required\` with no key, the same with
\`REQUIRE_API_KEY=false\`, and \`keys list\` exposes only upstream provider keys — no client
key. Shipping a router I cannot drive would repeat the failures this release cleans up.

### Verification
- 180 tests pass with no skips. No Octopus reference remains in any shipping file.
- TypeScript check clean; production web build clean; packaged app smoke-tested, and the
  installers below were built fresh from this commit.

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
    {path: 'release/MicoCode-Setup-0.8.5-x64.exe', name: 'MicoCode-Setup-0.8.5-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
    {path: 'release/MicoCode-Portable-0.8.5-x64.exe', name: 'MicoCode-Portable-0.8.5-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
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
