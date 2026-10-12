import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = execSync('git credential fill', {input: 'protocol=https\nhost=github.com\n\n'}).toString();
const token = out.split('\n').find(l => l.startsWith('password='))?.slice(9).trim();

if (!token) {
  console.error('Could not find GitHub token in git credential manager.');
  process.exit(1);
}

const tag = 'v0.7.91';
const name = 'MicoCode 0.7.91 — One Polished Dropdown Everywhere';
const checksums = fs.readFileSync('release/SHA256SUMS.txt', 'utf8').trim();

const body = `## MicoCode v0.7.91 — Every Dropdown Shares the Model Menu's Treatment

Native \`<select>\` popups cannot be themed, so the workspace no longer uses any.
All eleven are now the same control the model menu is built on.

### What's New in v0.7.91
- **One dropdown, one surface**: A shared control replaces the six dropdowns in Settings, the three in Models, the preview entry file, and publish visibility. The panel, rows, group headings and empty state are declared once for both this control and the model menu, so the two cannot drift apart.
- **It knows where it is**: A menu that would be clipped by the dialog around it flips above its trigger, never takes more height than the space it actually has, and lifts above the fields that follow it instead of being painted underneath them. Previously a long list near the bottom of a dialog was cut off mid-row.
- **Keyboard and typeahead**: Arrow keys, Home/End and Enter drive a highlight that scrolls into view; Escape closes and returns focus to the trigger; typing a letter jumps to the matching option and pressing it again cycles through the rest. The control exposes \`role="combobox"\`, \`role="listbox"\`/\`role="option"\`, \`aria-selected\` and \`aria-activedescendant\`.
- **It still reads as a field**: The closed control keeps the app's form-field styling in each context — dialog fields, the connections panel, and the quiet preview address bar — and follows the large-text and compact-density preferences.
- **The free-model list is grouped like the catalogue it comes from**, by provider prefix, instead of one flat run of model IDs.

### Verification
- 175 tests pass with no skips (4 new). They fail the build if a native \`<select>\` returns, if the dropdown surface stops being declared together with the model menu, if the menu becomes translucent or asks for a backdrop root, or if the trigger loses its focus ring or its large-text/compact-density variants.
- Every dropdown was rendered in Electron and inspected: the settings panel, the connections free-model list, publish visibility, and the preview entry file — including a 29-option list near the bottom of the viewport and a menu too short on space below its trigger. Keyboard behaviour (arrows, wrap, Enter, focus return) was measured from the DOM rather than inferred from a screenshot.
- TypeScript check clean; production web build clean; Windows installers packaged fresh from this commit and their SHA-256 digests recorded below.

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
    {path: 'release/MicoCode-Setup-0.7.91-x64.exe', name: 'MicoCode-Setup-0.7.91-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
    {path: 'release/MicoCode-Portable-0.7.91-x64.exe', name: 'MicoCode-Portable-0.7.91-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
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
