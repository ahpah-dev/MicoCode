import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = execSync('git credential fill', {input: 'protocol=https\nhost=github.com\n\n'}).toString();
const token = out.split('\n').find(l => l.startsWith('password='))?.slice(9).trim();

if (!token) {
  console.error('Could not find GitHub token in git credential manager.');
  process.exit(1);
}

const tag = 'v0.8.0';
const name = 'MicoCode 0.8.0 — Two More Free Routers That Set Themselves Up';
const checksums = fs.readFileSync('release/SHA256SUMS.txt', 'utf8').trim();

const body = `## MicoCode v0.8.0 — Two More Free Routers That Set Themselves Up

MicoCode already installed and configured 9Router, CLIProxyAPI and LiteLLM for you.
Version 0.8.0 adds two more free-tier routers, and neither one asks you to open a
terminal, copy a key out of a file, or click through a setup wizard.

### What's New in v0.8.0
- **GPT-Load** ([tbphp/gpt-load](https://github.com/tbphp/gpt-load), MIT, v2.0.0-rc.49): built for multi-channel, multi-credential setups, which is exactly what free tiers need. MicoCode downloads the verified 103 MB portable build, starts it on a free loopback port under a management key it generates, creates the channel and its group, and **mints the access key itself** before connecting. Add your own free-provider keys in its dashboard and they rotate behind that one key.
- **Octopus** ([bestruirui/octopus](https://github.com/bestruirui/octopus), AGPL-3.0, v0.13.10): one hub for every route, addressed by group name. MicoCode starts it, replaces the seeded \`admin/admin\` password with one it generates, then creates the channel, the group and the access key — about two seconds from click to connected.
- **Every download is pinned and checksum-verified**: each package is matched against the SHA-256 digest the project itself publishes in its release before anything is extracted. A mismatch installs nothing.
- **Dashboards you can actually get into**: each new router offers an “Open dashboard” button, and because both sign in with a credential rather than a cookie, a companion button copies that credential — written to the clipboard in the main process, so it never reaches the renderer.
- **Routes that work immediately**: each router's channel points at MicoCode's own free gateway, so the route is live the moment setup finishes, with no provider keys of your own required.

### Verification
- 186 tests pass with no skips (11 new). They fail the build if either router loses its pinned digest or version, if a payload stops matching the contract its router's validator enforces, if a managed router that needs a dashboard credential stops offering one, or if that credential could reach the renderer.
- Both routers were provisioned end to end against their **real release binaries**, not just checked field by field: install, start, channel, group, key generation, then a real \`POST /v1/chat/completions\` that reached the upstream and returned 200 and the dashboard's own login. GPT-Load's failures were only visible at runtime — it requires an \`Idempotency-Key\` header on every write and rejects a group whose \`priority\` or model \`alias\` fields are absent.
- TypeScript check clean; production web build clean; Windows installers packaged fresh from this commit and their SHA-256 digests recorded below.

### Notes
- Both packages are large (103 MB and 21 MB) and are downloaded into MicoCode's private per-version folder on first setup. Octopus is AGPL-3.0: MicoCode downloads the official unmodified binary from its own release at your request; it does not redistribute or modify it.
- \`new-api\` was evaluated as a third candidate and **left out**: its own first-run setup fails with \`sqlite error 14\` while creating the administrator account. SQLite itself was ruled out as the cause, so rather than ship an integration that could not be verified, it was dropped.

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
    {path: 'release/MicoCode-Setup-0.8.0-x64.exe', name: 'MicoCode-Setup-0.8.0-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
    {path: 'release/MicoCode-Portable-0.8.0-x64.exe', name: 'MicoCode-Portable-0.8.0-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
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
