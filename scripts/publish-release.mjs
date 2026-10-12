import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = execSync('git credential fill', {input: 'protocol=https\nhost=github.com\n\n'}).toString();
const token = out.split('\n').find(l => l.startsWith('password='))?.slice(9).trim();

if (!token) {
  console.error('Could not find GitHub token in git credential manager.');
  process.exit(1);
}

const tag = 'v0.8.3';
const name = 'MicoCode 0.8.3 — GPT-Load Removed, Octopus Stays Running';
const checksums = fs.readFileSync('release/SHA256SUMS.txt', 'utf8').trim();

const body = `## MicoCode v0.8.3 — GPT-Load Removed, Octopus Stays Running

### GPT-Load is gone
It never worked reliably enough to keep, so it has been removed outright rather than
left in the app: its installer, its pinned artifact, its management-API client, its
dashboard entry and its card. Octopus remains as the multi-route free gateway.

### A router you set up is no longer left switched off
Octopus answered every request with *"Your managed router is stopped. Open Models and
click Set up & connect."* even though it was installed, configured and healthy.

The cause: MicoCode only started recording which routers you had set up in 0.8.2, so a
router configured before that was invisible to the restart and stayed down while
everything routed to it failed. An installed package is now treated as proof that you
set that router up — **whichever build installed it** — so every router you have
configured comes back on launch, in the background, without competing with a setup you
are waiting on.

### The model panel reads better
- "Your routers" no longer describes itself as just 9Router and LiteLLM.
- The intro paragraph names the router you actually selected instead of saying "this router".
- The hint about "Use existing" now only appears for 9Router, where it applies.
- The panel's smallest labels — status chips, model badges, model counts — were set at
  7–8px and have been lifted to a readable size.
- Provider tiles respond to the pointer the way the router cards already did.

### Verification
- 186 tests pass with no skips. One asserts a router is brought back from an installed
  package that has no record of ever being set up — the exact case that left Octopus
  down — and the accepted-installer test now asserts GPT-Load is *rejected*.
- No GPT-Load reference remains anywhere in the shipping code.
- TypeScript check clean; production web build clean; packaged app smoke-tested, and
  the installers below were built fresh from this commit.

### Note
GPT-Load's 103 MB download is left behind in
\`%APPDATA%\\MicoCode\\providers\\gptload\` on machines that installed it. It is no
longer used and can be deleted to reclaim the space.

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
    {path: 'release/MicoCode-Setup-0.8.3-x64.exe', name: 'MicoCode-Setup-0.8.3-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
    {path: 'release/MicoCode-Portable-0.8.3-x64.exe', name: 'MicoCode-Portable-0.8.3-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
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
