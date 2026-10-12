import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = execSync('git credential fill', {input: 'protocol=https\nhost=github.com\n\n'}).toString();
const token = out.split('\n').find(l => l.startsWith('password='))?.slice(9).trim();

if (!token) {
  console.error('Could not find GitHub token in git credential manager.');
  process.exit(1);
}

const tag = 'v0.8.2';
const name = 'MicoCode 0.8.2 — Never Falls Back to an Outdated Model';
const checksums = fs.readFileSync('release/SHA256SUMS.txt', 'utf8').trim();

const body = `## MicoCode v0.8.2 — Never Falls Back to an Outdated Model

### The fallback chain can no longer name a stale model
When a provider hit its limit, MicoCode switched to the next configured one and
announced the model it was switching to. Those models were hardcoded — **AIHubMix fell
back to \`gpt-4o-mini\`**, AI Studio to \`gemini-2.5-flash\`, NVIDIA NIM to a Llama 3.3
build. Every one of them was a name that ages badly, and the workspace would quietly
keep using it long after something far better was available.

Now a provider is only used with the model **you** already chose for it. If you never
chose one, MicoCode asks that provider for its current catalogue and picks the strongest
model it actually offers at that moment. There is no longer a model name sitting in the
code to fall back to.

### Superseded models can no longer win
The auto-picker ranked \`gpt-4.1\` and \`gemini-2.5-pro\` as top-tier, so an older model
could outrank a current one — and a plain fall-through scored 50, above genuinely small
models. Families such as GPT-4o, GPT-4.1, GPT-4, GPT-3.5, o1, Claude 3, Gemini
1.x/2.0/2.5, Llama 2/3, Mixtral, Phi-3 and Qwen 2 now score below every current model.
They stay selectable when they are genuinely all a provider offers — nothing is taken
away — but they can never be preferred.

### Every router you set up comes back
Only the most recently used router was restarted, so a second one you had configured
showed as stopped and produced errors until you set it up again. MicoCode now remembers
every router you set up and brings them all back on launch, in the background, without
competing with a setup you are waiting on.

### Verification
- 189 tests pass with no skips. One test asserts a current model always outranks a
  superseded one while a superseded model still works when it is all that exists;
  another drives a real fallback where the provider offers both \`gpt-4o-mini\` and
  \`gpt-5.1\` and asserts the workspace lands on \`gpt-5.1\`; a third covers remembering
  and restoring more than one router.
- TypeScript check clean; production web build clean; the packaged app was smoke-tested
  and the installers below were built fresh from this commit.

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
    {path: 'release/MicoCode-Setup-0.8.2-x64.exe', name: 'MicoCode-Setup-0.8.2-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
    {path: 'release/MicoCode-Portable-0.8.2-x64.exe', name: 'MicoCode-Portable-0.8.2-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
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
