import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = execSync('git credential fill', {input: 'protocol=https\nhost=github.com\n\n'}).toString();
const token = out.split('\n').find(l => l.startsWith('password='))?.slice(9).trim();

if (!token) {
  console.error('Could not find GitHub token in git credential manager.');
  process.exit(1);
}

const tag = 'v0.8.6';
const name = 'MicoCode 0.8.6 — OmniRoute, Free Models Only';
const checksums = fs.readFileSync('release/SHA256SUMS.txt', 'utf8').trim();

const body = `## MicoCode v0.8.6 — OmniRoute, Free Models Only

### OmniRoute is in, and it is locked to free models
[OmniRoute](https://github.com/diegosouzapw/OmniRoute) (MIT, ~76k stars) puts one endpoint in
front of hundreds of providers. MicoCode now installs it over npm with the Node runtime it
already bundles for 9Router, runs it headless on a free loopback port with its own private data
directory, and mints an access key for it.

**That key is restricted to the free catalogue.** MicoCode reads OmniRoute's own free-model
catalogue, keeps only the models whose provider publishes a free tier, drops the ones gated
upstream, and hands exactly that set to the key. Anything else is invisible to it:

\`\`\`
models visible to the key     171
request for a paid combo      403
\`\`\`

So this route cannot spend money — the restriction is enforced by the router itself, not by a
list in the interface that could drift.

Free routes measured on a clean install include GPT-5.4 Mini, GPT-5.6 Luna, Claude Haiku 4.5,
Mistral Small, gpt-oss-120b and Gemma 4, alongside AI Horde's community models.

### Why some providers are excluded
OpenCode's free tier only answers from inside OpenCode — it returns
\`403: can only be used from within OpenCode\` to anything else. Offering it would hand you a
route that always fails, so it is filtered out of the free set.

### Verification
- 182 tests pass with no skips. Two are new: one asserts OmniRoute is a managed router pinned to
  an npm version with no downloadable artifact to pin, the other proves the free filter keeps
  free providers, drops gated ones, and allows nothing when a provider has no free tier.
- The whole path was run against the real 520 MB package: install, headless start, key creation,
  free-only restriction, and a \`GET /v1/models\` through MicoCode's own server returning the same
  set of models. A paid combo was refused with 403.
- TypeScript check clean; production web build clean; packaged app smoke-tested, and the
  installers below were built fresh from this commit.

### A note on the install
OmniRoute is delivered over npm rather than a pinned download, the same way 9Router is. The
version is pinned in the app, the install is the first thing setup does, and it takes a few
minutes and about 520 MB.

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
    {path: 'release/MicoCode-Setup-0.8.6-x64.exe', name: 'MicoCode-Setup-0.8.6-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
    {path: 'release/MicoCode-Portable-0.8.6-x64.exe', name: 'MicoCode-Portable-0.8.6-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
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
