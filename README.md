# MicoCode

A local-first browser coding workspace with a real agent loop, CodeMirror editor, isolated HTML/CSS/JavaScript preview, project import/export, staged diffs, and checkpoints.

## Run locally

Requires Node.js 22.13+.

    npm ci
    npm run dev

The website runs at http://127.0.0.1:5175 and the workspace at /app/. To build: `npm run build`.

Hosted app: https://micocode.vercel.app/app/
Introduction and downloads: https://micocode.vercel.app

`npm run package:kit` regenerates the local model kit. `npm run typecheck` checks TypeScript. The Vercel deployment serves the landing page and workspace together, with the cloud relay in `/api`.

## Free inference

- Browser: WebLLM and Qwen2.5 Coder, downloaded to the browser and run with WebGPU. No provider quota; hardware, memory, and context limits apply. This path is integrated and type/build checked, but a browser model download was not performed during release verification.
- Ollama: use an existing local model. A dependency-free loopback relay is included at `public/micocode-proxy.mjs`. Run `node public/micocode-proxy.mjs --origin https://YOUR-SITE`. It listens on 127.0.0.1:11435 and forwards only model listing and chat to Ollama on 127.0.0.1:11434. No OS shell or filesystem access is exposed. Keep it running while using local inference. MicoCode automatically discovers this relay when no other provider is configured.
- OpenRouter: the built-in HTTPS relay accepts your session API key and only free model IDs with a zero-price routing limit. The current free catalogue is fetched dynamically. Provider quotas and availability apply. No cloud key was available for an end-to-end cloud generation test.

No paid fallback, random public proxy, API-key sharing, or quota evasion is used.

## Agent workflow

Describe a task → inspect files → stage writes/deletes → run basic project checks → review diff → apply. Each application saves an automatic checkpoint. Plan mode cannot write or delete. Stop interrupts generation and preserves staged edits. Small models may produce invalid responses or need smaller tasks.

## Storage and privacy

Projects, conversations, proposed edits, and up to 20 checkpoints live in browser IndexedDB. API keys live only in sessionStorage and are never persisted by the relay. Cloud inference sends prompts and requested file contents to OpenRouter and its provider. Secret and dependency paths are excluded on import and from agent tools. Exports contain current applied files, not pending edits. Export regularly: clearing site data removes projects.

## Browser edition scope

HTML/CSS/JavaScript projects run in a sandbox without same-origin access. Local JS imports are rewritten for preview. Circular module imports, npm packages requiring a build, Node/Python servers, a full OS terminal, Git remotes, collaboration, and deployment of generated projects are not part of this edition. The console exposes named workspace commands and preview output, never a fake shell. Import supports up to 150 text files, 150 KB/file, and 2 MB total. Project checks validate JSON and HTML resource references, not full JS syntax or application correctness.

## Verification

- `node --test tests/core.test.mjs`: path traversal/prototype protection, secret filtering, stage isolation, response validation, project checks, and diff output.
- `npx tsc --noEmit` and production build.
- `node scripts/check-agent.mjs`: real local Ollama integration test. This optional release test expects a local relay and the model named in the test; adjust the model to your machine.
- Browser checks: agent request, staged review, apply, checkpoint restore, preview script execution and console capture, responsive workspace.

## Design and scope

MicoCode is independent software inspired by agentic coding workflows such as OpenCode and Antigravity. It is not affiliated with those products. This release is a browser edition, not a desktop installer. The local kit contains a Windows launcher and cross-platform inference relay; it requires Node.js and an installed Ollama model.
