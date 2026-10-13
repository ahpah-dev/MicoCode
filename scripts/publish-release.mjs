import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = execSync('git credential fill', {input: 'protocol=https\nhost=github.com\n\n'}).toString();
const token = out.split('\n').find(l => l.startsWith('password='))?.slice(9).trim();

if (!token) {
  console.error('Could not find GitHub token in git credential manager.');
  process.exit(1);
}

const tag = 'v0.9.2';
const name = 'MicoCode 0.9.2 — FreeLLMAPI Runs as a Server, Not an App';
const checksums = fs.readFileSync('release/SHA256SUMS.txt', 'utf8').trim();

const body = `## MicoCode v0.9.2 — FreeLLMAPI Runs as a Server, Not an App

### The desktop app was the wrong way to run it
0.9.0 and 0.9.1 installed FreeLLMAPI's **Electron desktop app**. It downloads fine and
extracts fine — but it never runs. It creates its data folder, then dies silently: no
window, no tray icon, no log, no Windows crash entry, and port 3001 never opens. Two
releases were built on a binary that will not start.

FreeLLMAPI is a Node monorepo. Run as a **server** it works, and its own
\`package.json\` fits MicoCode exactly:

\`\`\`
"engines": { "node": ">=20.18.0 <25.0.0" }     MicoCode ships Node 24.21.0
"scripts": { "build:server": ... }
\`\`\`

### What changed
Setup now downloads the **source** and runs it on MicoCode's bundled Node:

| | before | now |
| --- | --- | --- |
| Download | 148 MB Electron zip | **8 MB source zip** |
| Install | — | 834 packages, **58s** |
| Result | dies silently | **boots and serves** |

### Verified by actually running it
This is the first FreeLLMAPI work in this project that was watched running rather than
inferred — a Node process can be launched in the build sandbox, an Electron app cannot:

\`\`\`
Database initialized at ...\\server\\data\\freeapi.db
Seeded 25 models and fallback config
A unified API key was generated. Open the dashboard and retrieve it from the Keys page.
First-run setup code: X8E78RUUFA
[crypto] No ENCRYPTION_KEY set - generated a local dev key beside the database
\`\`\`

Three traps were found and handled while verifying:

- **Native module ABI.** \`better-sqlite3\` compiled against the machine's Node instead of
  MicoCode's and the server died with \`NODE_MODULE_VERSION 147 vs 137\`. Setup now puts
  MicoCode's runtime first on \`PATH\`, which is what selects the right build.
- **Build the client too.** \`build:server\` alone leaves the dashboard 404ing — and the
  dashboard is where provider keys and the unified key come from.
- **Do not set \`NODE_ENV=production\`.** The server then refuses to start without an
  \`ENCRYPTION_KEY\`. Without it, it generates its own key beside the database.

### What to do
Set up FreeLLMAPI from Models, then click **Open FreeLLMAPI dashboard**: add one provider
key (Google, Groq and Cerebras all have free tiers) and paste the unified key into the API
key field. **It still serves nothing until you add a key of your own** — that is what
FreeLLMAPI is, an aggregator for your own free tiers.

### Verification
- **190 tests pass with no skips**; TypeScript check clean; web build clean; packaged app
  smoke-tested with all seven providers reporting; installers built fresh from this commit.
- Not verified: a chat completion through the router. That needs a real provider key, which
  the build sandbox does not have.

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
    {path: 'release/MicoCode-Setup-0.9.2-x64.exe', name: 'MicoCode-Setup-0.9.2-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
    {path: 'release/MicoCode-Portable-0.9.2-x64.exe', name: 'MicoCode-Portable-0.9.2-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
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
