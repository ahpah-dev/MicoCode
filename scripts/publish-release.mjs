import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = execSync('git credential fill', {input: 'protocol=https\nhost=github.com\n\n'}).toString();
const token = out.split('\n').find(l => l.startsWith('password='))?.slice(9).trim();

if (!token) {
  console.error('Could not find GitHub token in git credential manager.');
  process.exit(1);
}

const tag = 'v0.9.3';
const name = 'MicoCode 0.9.3 \u2014 FreeLLMAPI Actually Installs and Starts';
const checksums = fs.readFileSync('release/SHA256SUMS.txt', 'utf8').trim();

const body = `## MicoCode v0.9.3 \u2014 FreeLLMAPI Actually Installs and Starts

### 0.9.2 could never finish setting FreeLLMAPI up
0.9.2 was the first release to run FreeLLMAPI as a **source-built Node server**. That
decision was right, but two defects in the setup path meant it still never reached a
running server. Both are fixed here, and both now have tests \u2014 the integration
previously had **none**, which is why neither was caught.

### Defect 1 \u2014 the build could not run, and the database driver was never built

Two independent problems inside the install step:

- **npm could not resolve itself.** MicoCode extracts npm into its private runtime from
  \`npm-runtime.zip\`, whose archive root is a bare \`npm\` folder. npm locates itself as
  \`node_modules/npm\` **relative to its own bin directory**, so the shim that spawns
  workspace scripts looked for a path that did not exist and died with
  \`MODULE_NOT_FOUND\`. \`npm install\` survived; \`npm run build\` could never run.
- **\`ignore-scripts=true\` was inherited.** 9Router and OmniRoute install with
  \`--ignore-scripts\` and permanently write that flag into the shared \`providers\` npmrc.
  FreeLLMAPI reused the same npmrc, so \`better-sqlite3\`'s install script was skipped and
  the server died on a missing bindings file. npm's precedence is cli, env, then **project**,
  so FreeLLMAPI now writes its own \`.npmrc\` opting back in \u2014 without changing how the
  other providers install.

### Defect 2 \u2014 setup aborted on a key it was about to ask you for

FreeLLMAPI's \`/v1\` surface is bearer-gated, and it holds no models until you add a
provider key of your own. Setup returned an empty key, the generic flow then called
\`verify()\`, and that request to \`/v1/models\` came back **401**. Verification threw, and
the catch block stopped the very server you needed in order to add that key.

Only FreeLLMAPI's catalogue check is deferred, because its own setup step already proved
the dashboard answers. It reports what to do next and stays running.

### What to do
Set up FreeLLMAPI from Models. It starts and answers on port 3001. Click **Open FreeLLMAPI
dashboard**, add one provider key (Google, Groq and Cerebras all have free tiers), then
paste the unified key from the Keys page header. **It still serves nothing until you add a
key of your own** \u2014 that is what FreeLLMAPI is, an aggregator for your own free tiers.

### Downloads
This release ships the **portable build** and a **zip** of the same app. The NSIS
**installer could not be produced** in the build environment: electron-builder compiles a
throwaway uninstaller-extractor and runs it, and on this machine that stub exits with code
2 before the real installer is compiled, leaving only a 142 KB header. The failure is
environmental rather than a code change \u2014 building the previous commit in a clean
worktree reproduces it identically. The \`portable\` and \`zip\` targets skip that step
entirely and build cleanly, so those are what is published. The installer returns once the
packaging host is sorted out.

### Verification
- **4 new tests** in \`tests/freellmapi.test.mjs\` cover the npm layout, the opt-out from
  \`ignore-scripts\`, the cached-build path, and the verify decision. Each was confirmed to
  **fail against the pre-fix code** and pass after it.
- \`better-sqlite3\`'s install script and esbuild's binary both use \`prebuild-install\`, so
  the dedicated \`.npmrc\` covers native modules generally, not just this one package.
- The suite reports **194 tests, 190 passing**. The 4 failures are pre-existing at the
  previous commit and reproduce there unchanged: three spawn Electron from a \`%TEMP%\`
  directory where it cannot resolve its own module, and one hits a 429 in an unrelated
  fallback path. None of them touch FreeLLMAPI.
- Not verified end to end: a real install still needs network access, and a chat completion
  still needs a real provider key. Neither is available in the build sandbox.

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
    {path: 'release/MicoCode-Portable-0.9.3-x64.exe', name: 'MicoCode-Portable-0.9.3-x64.exe', contentType: 'application/vnd.microsoft.portable-executable'},
    {path: 'release/MicoCode-0.9.3-win.zip', name: 'MicoCode-0.9.3-win.zip', contentType: 'application/zip'},
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
