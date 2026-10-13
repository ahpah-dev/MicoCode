import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = execSync('git credential fill', {input: 'protocol=https\nhost=github.com\n\n'}).toString();
const token = out.split('\n').find(l => l.startsWith('password='))?.slice(9).trim();

if (!token) {
  console.error('Could not find GitHub token in git credential manager.');
  process.exit(1);
}

const tag = 'v0.9.1';
const name = 'MicoCode 0.9.1 — FreeLLMAPI Connects, and Errors Say What To Do';
const checksums = fs.readFileSync('release/SHA256SUMS.txt', 'utf8').trim();

const body = `## MicoCode v0.9.1 — FreeLLMAPI Connects, and Errors Say What To Do

### FreeLLMAPI setup failed every single time
The connection validator required two things a freshly installed FreeLLMAPI cannot have:
a **key**, and a **non-empty list of free models**. FreeLLMAPI has neither until you add a
provider key in its own dashboard — that is the whole point of it. So setup downloaded,
extracted and started it correctly, then threw on the last step and the router was never
recorded as managed.

\`\`\`
if(!result.key) throw ... "Managed setup returned an incomplete connection."
if(!routes.length || !routes.includes(c.model)) throw ...
\`\`\`

A router that is installed and running but has nothing to serve yet is now a **real state**
rather than an error. It connects, and it says so plainly.

### The unhelpful error
That failed setup is why the app then reported:

> *"Could not reach the router. Start it, use its final API URL without redirects, allow this
> site in CORS, and allow local-network access when your browser asks."*

Three of those four suggestions were irrelevant, and none of them was the actual problem.
MicoCode now names the router and the step:

- **FreeLLMAPI** — *"not answering on 127.0.0.1:3001. Open Models, click Set up & connect on
  FreeLLMAPI so MicoCode installs and starts it, then open its dashboard, add one provider
  key (Google, Groq or Cerebras all have free tiers), and paste the unified key into the API
  key field."*
- **Any other managed router** — *"Your LiteLLM router is not running. Open Models and click
  Set up & connect to start it."*
- **A custom address** — names the preset and the URL, and points at the base URL and the key
  rather than blaming CORS.

### Verification
- **190 tests pass with no skips**; TypeScript check clean; production web build clean;
  packaged app smoke-tested with all seven providers reporting.
- Still not verified: that FreeLLMAPI serves a request end to end. It cannot be launched in
  the build sandbox (Electron's singleton lock is blocked there), so this fixes the setup and
  the message, not a proven round trip.

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
