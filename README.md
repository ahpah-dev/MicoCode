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
- Free proxies: connection presets for [9Router](https://github.com/decolua/9router), [LiteLLM](https://docs.litellm.ai/docs/simple_proxy), [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI), and any OpenAI-compatible endpoint. Routers must already be installed, running, and configured with authorized free routes. MicoCode does not install or sign you into these third-party tools. Use the setup link in Connections, paste your router's URL/key, and connect. Once configured, the preset's Connect button reconnects in one click.
- AI Horde: a fixed relay uses the community's documented anonymous access. Only live worker models are shown. This experimental route needs no key or billing, but volunteer queues, model quality, and availability vary. Model discovery was reachable; the live anonymous generation probe returned HTTP 500. It is not a guaranteed inference route.

### Configure a free proxy

In Models → Free proxies, select a preset. 9Router defaults to `http://127.0.0.1:20128/v1`; LiteLLM to port 4000; CLIProxyAPI to port 8317. Set your exact URL and key if needed. The browser calls these endpoints directly: configure CORS for your MicoCode origin and allow local-network access when prompted. Remote URLs must use HTTPS. Keys cannot be embedded in URLs and are never forwarded to a different endpoint.

The model picker hides paid and unknown models. It accepts explicit zero-price metadata, or exact model IDs you declare after checking **My router uses free routes only**. Known nonzero prices are always rejected. Disable paid fallbacks in your router: MicoCode cannot inspect or guarantee billing inside an opaque third-party router. A name containing “free” is not treated as proof of zero cost. No automatic cross-router fallback is performed.

### Smart limit handling and polished code

Connections → Momentum & code quality controls four defaults: smart limit handling, free OpenRouter fallback, lean context, and polished code. The request queue serializes generations per connection and paces cloud requests. It honors Retry-After / reset headers, retries transient errors at most twice with backoff, and supports immediate cancellation. Authentication, credit, budget, and daily-quota errors stop. Long resets return control instead of waiting indefinitely. Changing a model does not clear a connection cooldown. This improves resilience within provider rules; it does not remove quotas.

OpenRouter fallback only tries the free router under the same zero-price cap. Lean context retains the original task and latest tool results while dropping older results when the context budget is exceeded. File ranges and unique exact-match patches reduce full-file rewrites. Polished mode adds design/accessibility guidance and a final static review. Token savings are estimates; no fixed percentage or code quality guarantee is claimed.

No paid fallback, random public proxy, API-key sharing, or quota evasion is used.

## Agent workflow

Describe a task → inspect files or ranges → stage exact edits/writes/deletes → run resource and quality checks → review diff → apply. Each application saves an automatic checkpoint. Plan mode cannot write, edit, or delete. Existing-file rewrites require a full read; patches require previously read exact text that matches once. Stop interrupts generation and preserves staged edits. Invalid responses get at most two consecutive repair attempts. Small models may need smaller tasks.

## Storage and privacy

Projects, conversations, proposed edits, and up to 20 checkpoints live in browser IndexedDB. Connection URLs, declared free model IDs, and preferences are saved locally. API keys live only in sessionStorage, isolated by exact endpoint, and are never persisted by MicoCode's relay. Cloud inference sends prompts and requested file contents to the selected connection and its providers. Community services may process or retain this data under their own terms. Secret and dependency paths are excluded on import and from agent tools. Exports contain current applied files, not pending edits. Export regularly: clearing site data removes projects.

## Browser edition scope

HTML/CSS/JavaScript projects run in a sandbox without same-origin access. Local JS imports are rewritten for preview. Circular module imports, npm packages requiring a build, Node/Python servers, a full OS terminal, Git remotes, collaboration, and deployment of generated projects are not part of this edition. The console exposes named workspace commands and preview output, never a fake shell. Import supports up to 150 text files, 150 KB/file, and 2 MB total. Project checks validate JSON and HTML resource references, not full JS syntax or application correctness.

## Verification

- `npm test`: workspace protections, exact edits and partial reads, plan-mode isolation, quality checks, free-only filtering, endpoint/key isolation, retry timing and cancellation, quota stops, serialized requests, zero-price relay behavior, and arbitrary proxy rejection.
- `npx tsc --noEmit` and production build.
- `node scripts/check-agent.mjs`: real local Ollama integration test. This optional release test expects a local relay and the model named in the test; adjust the model to your machine.
- Browser checks: agent request, staged review, apply, checkpoint restore, preview script execution and console capture, responsive workspace.

## Design and scope

MicoCode is independent software inspired by agentic coding workflows such as OpenCode and Antigravity. It is not affiliated with those products. This release is a browser edition, not a desktop installer. The local kit contains a Windows launcher and cross-platform inference relay; it requires Node.js and an installed Ollama model.
