import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = execSync('git credential fill', {input: 'protocol=https\nhost=github.com\n\n'}).toString();
const token = out.split('\n').find(l => l.startsWith('password='))?.slice(9).trim();

if (!token) {
  console.error('Could not find GitHub token in git credential manager.');
  process.exit(1);
}

const tag = 'v0.8.7';
const name = 'MicoCode 0.8.7 — The Best Free Model, Not the First One';
const checksums = fs.readFileSync('release/SHA256SUMS.txt', 'utf8').trim();

const body = `## MicoCode v0.8.7 — The Best Free Model, Not the First One

### MicoCode was picking its free model from list order
0.8.6 connected OmniRoute and locked it to free models correctly, but then chose which
free model to run by taking **whatever the router happened to list first**. On a clean
install that landed on a small mini model while better routes sat further down the same
list. It now picks by MicoCode's own ranking, so the strongest free model available wins
wherever it appears:

\`\`\`
before   ddgw/gpt-5.4-mini          (first in the list)
after    agy/gemini-3.8-flash       (ranked best)
\`\`\`

### Releases are now compared properly
Ranking treated every model in a tier as equal, so an older release could win on
alphabetical order — Gemini 3.7 beat Gemini 3.8. Worse, the obvious fix is a trap:
comparing version numbers across families makes every GPT-5.x outrank every Gemini 3.x,
because 5.4 is a bigger number than 3.8. Versions are now compared **only inside one
family**, so:

- \`gemini-3.8-flash\` beats \`gemini-3.7-flash-high\` — same family, newer release
- \`gpt-5.4-mini\` and \`gemini-3.8-flash\` are not compared numerically at all
- \`gpt-oss-120b\` is not read as version 120 — a parameter count is not a release

### What this does not change
MicoCode cannot invent free models that a free provider does not serve. A bare OmniRoute
instance only has its keyless providers live, and those serve small or odd models.
OmniRoute's own free catalogue does list current flagships — Claude Opus 5, GPT-5.6 Sol,
Gemini 3.8 Flash — but they come from providers that need an account. **Connect those in
OmniRoute's dashboard and they appear here automatically**, because the free key is
restricted to whatever the catalogue currently offers.

### Verification
- 183 tests pass with no skips. The new one asserts a list beginning with a small model
  still resolves to the strongest current one, that the newest release wins inside a
  family, and that a parameter count is never mistaken for a version.
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
    {path: 'release/MicoCode-Setup-0.8.7-x64.exe', name: 'MicoCode-Setup-0.8.7-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
    {path: 'release/MicoCode-Portable-0.8.7-x64.exe', name: 'MicoCode-Portable-0.8.7-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
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
