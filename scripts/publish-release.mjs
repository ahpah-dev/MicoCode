import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = execSync('git credential fill', {input: 'protocol=https\nhost=github.com\n\n'}).toString();
const token = out.split('\n').find(l => l.startsWith('password='))?.slice(9).trim();

if (!token) {
  console.error('Could not find GitHub token in git credential manager.');
  process.exit(1);
}

const tag = 'v0.7.9';
const name = 'MicoCode 0.7.9 — Calmer Dialogs & Keyboard-First Quick Actions';
const checksums = fs.readFileSync('release/SHA256SUMS.txt', 'utf8').trim();

const body = `## MicoCode v0.7.9 — Calmer Dialogs, Keyboard-First Quick Actions & an Announced Workspace

A comfort and clarity pass over the whole workspace. Nothing about how MicoCode
talks to models changed; this release is about how the app feels to use.

### What's New in v0.7.9
- **Calmer, fully legible dialogs**: The modal scrim is painted instead of blurred. A \`backdrop-filter\` on \`::backdrop\` makes Chromium composite the entire top layer through the filter, which washed out the dialog itself as well as the page behind it, so how readable a dialog was depended on the graphics stack. The scrim now vignettes the workspace and the dialog surface stays opaque.
- **Dialogs that start in the right place**: Opening a dialog focuses the first field you can actually type into — never Close, and never a read-only field — and closing it returns focus to the button that opened it.
- **Keyboard-first quick actions (Ctrl K)**: Arrow keys, Home, and End move a highlight that scrolls into view, Enter runs it, and the rows carry shortcut chips, listbox semantics (\`role="listbox"\`, \`aria-activedescendant\`), and a real empty state. The list grew from 12 to more than 20 actions with search keywords, covering views, panels, settings, project checks, and the guide.
- **More shortcuts, and a place to find them**: \`Ctrl B\` toggles the explorer, \`Ctrl J\` the console, \`Ctrl ,\` opens settings, and \`Ctrl Shift M\` the Mico panel. \`Ctrl K\` now toggles quick actions instead of silently replacing whatever dialog is open. Help has a new Keyboard section listing all eleven keys.
- **Announced, not just drawn**: The message stream, workspace console, preview console, and save state are live regions, the agent panel reports \`aria-busy\` while it works, and twenty icon-only controls across the activity rail, Source Control, Preview, and publishing gained accessible names instead of relying on a tooltip.
- **Smaller fixes**: Changed-file rows in Source Control are real buttons and are reachable by keyboard; Escape closes the preview console drawer after element inspection is cancelled.

### Verification
- 171 tests pass with no skips (9 new), including checks that fail the build if a shortcut documented in Help stops being handled, if a blur returns to the dialog scrim, if a changed-file row goes back to being a click-only \`div\`, or if a tooltip-only control loses its accessible name.
- TypeScript check clean; production web build clean; Windows installers packaged fresh from this commit and their SHA-256 digests recorded below.
- The new dialog scrim, the quick-action listbox, the keyboard reference in Help, and Source Control were each rendered in Electron and inspected, not assumed.

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
    {path: 'release/MicoCode-Setup-0.7.9-x64.exe', name: 'MicoCode-Setup-0.7.9-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
    {path: 'release/MicoCode-Portable-0.7.9-x64.exe', name: 'MicoCode-Portable-0.7.9-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
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
