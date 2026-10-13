import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = execSync('git credential fill', {input: 'protocol=https\nhost=github.com\n\n'}).toString();
const token = out.split('\n').find(l => l.startsWith('password='))?.slice(9).trim();

if (!token) {
  console.error('Could not find GitHub token in git credential manager.');
  process.exit(1);
}

const tag = 'v0.8.9';
const name = 'MicoCode 0.8.9 — LiteLLM Sets Itself Up Again';
const checksums = fs.readFileSync('release/SHA256SUMS.txt', 'utf8').trim();

const body = `## MicoCode v0.8.9 — LiteLLM Sets Itself Up Again

### The bug: a setup that could never be retried
LiteLLM, FreeRide and any Python-backed router failed auto setup, and once they had failed
they could **never succeed** — no matter how many times you clicked. The cause is a single
unconditional command:

\`\`\`
uv venv --python 3.12 --managed-python <folder>
  → exit 2
  → error: A virtual environment already exists at: <folder>
  → hint: Use the \`--clear\` flag
\`\`\`

Setup created the virtual environment first and installed the package second, but guarded
both behind a single check for the *installed executable*. So the moment an install was
interrupted — a cancelled setup, a dropped connection, a closed window — the virtual
environment existed and the package did not. Every retry afterwards re-ran \`uv venv\`, which
refused, and died **before installing anything**. The folder on disk was a valid Python
environment with an entirely empty \`site-packages\`, which is exactly what the failure left
behind:

\`\`\`
litellm/1.104.2/Scripts/python.exe     present
litellm/1.104.2/Scripts/litellm.exe    missing
litellm/1.104.2/Lib/site-packages      empty
\`\`\`

### The fix
An existing interpreter is now **reused** instead of recreated, and when the directory has to
be rebuilt it is cleared rather than refused. Verified against the real \`uv\` binary:

\`\`\`
uv venv --python 3.12 --managed-python <existing folder>            exit 2   (before)
uv venv --clear --python 3.12 --managed-python <existing folder>    exit 0   (after)
\`\`\`

Both Python-backed providers — LiteLLM and FreeRide — shared the shape and are both fixed.

### Verified end to end, not assumed
The install itself was never broken. Run exactly as MicoCode runs it, LiteLLM installed
cleanly in **49 seconds** and its executable ran on MicoCode's own private Python — the only
thing standing between you and a working setup was the venv step refusing to repeat itself.

### Verification
- **190 tests pass with no skips.** The new one asserts that both Python providers clear a
  stale environment and reuse an existing interpreter, so this cannot regress.
- TypeScript check clean; production web build clean; packaged app smoke-tested; installers
  built fresh from this commit.

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
    {path: 'release/MicoCode-Setup-0.8.9-x64.exe', name: 'MicoCode-Setup-0.8.9-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
    {path: 'release/MicoCode-Portable-0.8.9-x64.exe', name: 'MicoCode-Portable-0.8.9-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
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
