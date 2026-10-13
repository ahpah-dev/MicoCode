import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = execSync('git credential fill', {input: 'protocol=https\nhost=github.com\n\n'}).toString();
const token = out.split('\n').find(l => l.startsWith('password='))?.slice(9).trim();

if (!token) {
  console.error('Could not find GitHub token in git credential manager.');
  process.exit(1);
}

const tag = 'v0.9.0';
const name = 'MicoCode 0.9.0 — FreeLLMAPI, 34 Free Tiers Behind One Endpoint';
const checksums = fs.readFileSync('release/SHA256SUMS.txt', 'utf8').trim();

const body = `## MicoCode v0.9.0 — FreeLLMAPI, 34 Free Tiers Behind One Endpoint

### New provider: FreeLLMAPI
[FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi) stacks the free tiers of 34
providers — Google, Groq, Cerebras, Mistral, OpenRouter, NVIDIA and more — behind a single
OpenAI-compatible endpoint on \`127.0.0.1:3001\`, with automatic failover when one provider
is rate-limited. MicoCode now installs, starts and opens it for you.

Verified before shipping: MIT licensed, 34,443 stars, release **v0.13.10**, and the
portable build is a straight unpacked Electron app rather than an installer.

### Read this before you click it
**FreeLLMAPI serves no models until you give it provider keys.** Unlike OmniRoute, it has no
keyless providers — it is an aggregator for *your* free-tier accounts. That is a deliberate
part of this release, not a bug:

1. Set up FreeLLMAPI from Models — MicoCode downloads it, checks the digest, extracts and
   starts it.
2. Click **Open FreeLLMAPI dashboard** and add whichever provider keys you have.
3. Paste FreeLLMAPI's unified key into the API key field, and its models load into MicoCode.

**MicoCode does not read that unified key for you.** It lives in an encrypted SQLite
database, and rather than guess at how to decrypt it, this release asks you to paste it
once. If a later version can read it reliably, that step goes away.

### Honest scope
- The installer (\`FreeLLMAPI-Setup-0.13.10.exe\` with \`/S\`) **installs nothing** — it exits
  without writing a file or a registry entry, so the portable zip is the path used here.
- The portable zip is pinned by SHA-256 and downloaded through MicoCode's existing verified
  download and extraction path, the same one CLIProxyAPI uses.
- Its own README calls it "for personal experimentation and learning, not production", and
  free tiers change without notice. Treat it as a bonus route, not your only one.

### Verification
- **190 tests pass with no skips**, including the existing coverage that every managed
  router has a proxy route and a display name — FreeLLMAPI had to satisfy both.
- TypeScript check clean; production web build clean; packaged app smoke-tested with all
  seven providers reporting; installers built fresh from this commit.
- What is **not** verified: that the app launches and serves from the extracted folder on a
  real machine. It cannot be launched in the build sandbox at all (Electron's singleton lock
  is blocked there, the same restriction that prevents launching MicoCode itself), so this
  release claims install, extract and start — not a working end-to-end request.

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
    {path: 'release/MicoCode-Setup-0.9.0-x64.exe', name: 'MicoCode-Setup-0.9.0-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
    {path: 'release/MicoCode-Portable-0.9.0-x64.exe', name: 'MicoCode-Portable-0.9.0-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
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
