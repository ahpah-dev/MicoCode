import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = execSync('git credential fill', {input: 'protocol=https\nhost=github.com\n\n'}).toString();
const token = out.split('\n').find(l => l.startsWith('password='))?.slice(9).trim();

if (!token) {
  console.error('Could not find GitHub token in git credential manager.');
  process.exit(1);
}

const tag = 'v0.8.8';
const name = 'MicoCode 0.8.8 — Mico Knows When to Stop';
const checksums = fs.readFileSync('release/SHA256SUMS.txt', 'utf8').trim();

const body = `## MicoCode v0.8.8 — Mico Knows When to Stop

### A stuck agent no longer spins
If Mico repeated a step that changed nothing, the loop simply ran it again — up to **100
identical model calls**, producing nothing and looking like the app had frozen. Three
separate failures shared that shape: re-reading the same file, re-running the same search,
and retrying an edit whose text was never in the file.

The loop now notices when an action returns a **byte-identical result**, corrects once, and
then stops with a plain explanation rather than burning the step budget:

\`\`\`
Stopped: the same step returned an identical result three times, so repeating it
cannot change anything. Your staged changes are kept. Tell Mico what to do
differently, or pick a stronger model in Models.
\`\`\`

Nothing you had staged is discarded, and genuinely different steps are never mistaken for a
loop — that is asserted by a test of its own.

### Mico knows when a turn is over
Saying "hi" used to produce *"I'm waiting for your instructions…"* over and over instead of
a reply and a stop, because the system prompt showed the model a \`"done":false\` example and
**never said when to set it true**. It now knows that greetings, questions and ordinary
conversation are finished immediately, and the loop independently ends any turn that took no
action — a turn that changes nothing cannot be made to change something by repeating it.

Mico is also told now to say **what it changed** when it finishes, and, when it is stuck, to
stop and say what is blocking it instead of looping.

### A removed router no longer crashes the workspace
A config saved against a router that has since been removed — Octopus and GPT-Load were both
taken out — dereferenced undefined while rendering the Models panel and dropped the whole
workspace onto its *"A display hiccup was caught and contained"* recovery screen. Anyone
upgrading with one of them still saved would have hit it. The saved router is now looked up
without assuming it exists, and a config naming a router that is gone is **repaired back to
the router picker** instead of being rendered.

### OmniRoute setup says what it is doing
Setting up OmniRoute announced **"Preparing Ollama…"** — its name was missing from the setup
screen's router list, so it fell through to the wrong one — and then ran a three-minute npm
install in silence. A working install looked like a hang. Every managed router now shares one
display-name table, and a long install reports that it is still working.

### Verification
- **189 tests pass with no skips**, including three new ones: a repeated no-op stops the run,
  a repeated failing edit stops the run, and a run of *different* steps is never treated as a
  loop.
- TypeScript check clean; production web build clean; packaged app smoke-tested; installers
  built fresh from this commit.
- Measured, not assumed: the repeated-step guard stops a stuck run in **3 model calls instead
  of 12**, and the OmniRoute install was run end to end — 1163 packages in 183 seconds,
  running on MicoCode's own bundled Node.

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
    {path: 'release/MicoCode-Setup-0.8.8-x64.exe', name: 'MicoCode-Setup-0.8.8-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
    {path: 'release/MicoCode-Portable-0.8.8-x64.exe', name: 'MicoCode-Portable-0.8.8-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
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
