import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = execSync('git credential fill', {input: 'protocol=https\nhost=github.com\n\n'}).toString();
const token = out.split('\n').find(l => l.startsWith('password='))?.slice(9).trim();

if (!token) {
  console.error('Could not find GitHub token in git credential manager.');
  process.exit(1);
}

const tag = 'v0.8.4';
const name = 'MicoCode 0.8.4 â€” The Right Router Comes Back';
const checksums = fs.readFileSync('release/SHA256SUMS.txt', 'utf8').trim();

const body = `## MicoCode v0.8.4 â€” The Right Router Comes Back

### MicoCode was restoring the wrong router
The workspace had saved "Octopus is my router" while the manager's own record of the last
router used said CLIProxyAPI. On launch only the last-used one was restored, so Octopus was
never started.

Worse, a managed router is meant to be reached through MicoCode's own server. With no
connection for Octopus, the workspace fell back to dialling its loopback port directly â€” which
is cross-origin, has no CORS headers, and therefore surfaced as **"Could not reach the router.
Start it, use its final API URL without redirects, allow this site in CORS, and allow
local-network access when your browser asks."** A stopped router was being reported as a
browser-permissions problem, which sends you looking in entirely the wrong place.

MicoCode now restores **the router the workspace actually has selected**, falling back to the
last-used one only when that selection is not installed.

### A stopped managed router now says so
Dialling a managed router directly is refused outright, so the message is:

> Your Octopus router is not running. Open Models and click Set up & connect to start it.

It also comes back on its own: every router you have installed is brought up at launch,
including ones installed by an earlier build that never recorded them.

### Verification
- 187 tests pass with no skips. A new test builds the exact mismatch â€” workspace selection
  versus last-used record, both installed â€” and asserts the selection wins, that the last-used
  router is used when nothing is selected, and that an uninstalled selection falls back rather
  than failing.
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
    {path: 'release/MicoCode-Setup-0.8.4-x64.exe', name: 'MicoCode-Setup-0.8.4-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
    {path: 'release/MicoCode-Portable-0.8.4-x64.exe', name: 'MicoCode-Portable-0.8.4-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
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
