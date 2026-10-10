# MicoCode

Little ideas. Real things. A free agentic coding workspace for Windows and the browser.

[Website & downloads](https://micocode.vercel.app) · [Browser workspace](https://micocode.vercel.app/app/) · [Windows releases](https://github.com/ahpah-dev/MicoCode/releases)

## Windows app

Download the x64 installer or portable executable. The workspace, Electron, and a private Node runtime are included. No separate Node installation or terminal is needed. Windows 10/11 x64 is supported. This community release is unsigned; Windows may show a publisher warning.

Open **Models → Free proxies → Set up & connect** on 9Router, CLIProxyAPI, or LiteLLM. MicoCode downloads the official provider, verifies release archives, installs it privately, starts it on localhost, configures a free route, and verifies the catalogue. Setup shows progress, supports cancellation, and reuses completed installations. No global npm installation, administrator access, pasted router key, or provider account is required for the default route.

The default **local engine** uses Ollama. MicoCode reuses an existing installation and model, or downloads the official portable runtime and Qwen Coder 1.5B automatically. A fresh setup may download a large runtime plus about 1 GB for the model. Local inference has no service quota or per-message fee; hardware, memory, context, and speed still matter.

The optional **community engine** uses AI Horde's documented anonymous access and sends prompts and requested files to volunteer workers. It is experimental: availability, queues, and model quality vary. The public service returned generation errors during the latest release probe, so it is not the default. Additional upstream accounts require your own authorized sign-in or key. MicoCode does not create accounts, bypass provider restrictions, or enable paid fallback.

**Ollama → Set up & connect** connects local models directly. MicoCode restores the last managed connection when reopened, stops processes it started when closed, and leaves pre-existing Ollama servers running. Installations stay in the application profile. The manager encrypts generated connection credentials with Windows encryption. Only the trusted workspace can invoke narrowly scoped native setup APIs; generated previews cannot access them.

## Appearance

Choose **Forest, Graphite, Midnight, Violet, or Paper** with the palette button or Settings. Workspace surfaces, controls, dialogs, and the editor follow the theme, which persists on the device. Paper is a light theme.

## Coding tools

- An agent loop reads files and ranges, searches, plans, stages exact edits/writes/deletes, and runs static resource and quality checks.
- Plan mode cannot change files. Existing-file rewrites require a full read; patches must match previously read text exactly once.
- Review diffs before applying. Applied changes create a checkpoint; up to 20 are retained. Stop preserves staged work.
- CodeMirror supplies autocomplete, folding, and syntax highlighting. The isolated HTML/CSS/JavaScript preview supports desktop/mobile views and console output.
- Create projects from templates, import text files or ZIPs, search, edit, and export applied files. Secret and dependency paths are excluded.

The console exposes named workspace commands, not an OS shell. npm builds, backend processes, Git remotes, and publishing generated projects require local development tools. Import supports 150 text files, 150 KB/file, and 2 MB total. Static checks do not replace runtime testing.

## Other free connections

The browser edition includes WebLLM/Qwen Coder on compatible WebGPU hardware, existing local Ollama, OpenRouter's zero-price router, anonymous AI Horde, and custom OpenAI-compatible endpoints. Automatic provider installation is exclusive to Windows.

For manually configured routers, set the exact URL and its own key. Remote endpoints must use HTTPS; allow the exact MicoCode origin in CORS. Browser keys are isolated by endpoint and remain in the tab's session. Discovery accepts verified zero pricing or exact routes declared free by the owner; known positive prices are excluded. Names containing “free” are not price proof. Downstream billing in manually configured routers remains the owner's responsibility.

OpenRouter requires your own key. Each request enforces zero maximum prompt/completion pricing, with free routes only for fallback. Provider quotas still apply. Smart limit handling honors retry/reset headers, paces requests, retries transient failures at most twice, and supports cancellation. Daily quota, budget, credit, and authentication errors stop. It does not remove limits or rotate credentials across providers.

Polished mode supplies responsive and accessibility guidance plus a final static review. Lean context preserves the original task and recent tool results, trims older results, reads ranges, and prefers exact edits. Small models benefit from smaller tasks; no quality or token-saving percentage is guaranteed.

## Storage and privacy

Projects, chats, proposed edits, and checkpoints live in IndexedDB on the device. Windows uses a persistent private profile; the website uses browser storage. Themes and preferences are saved locally. Browser API keys stay in session storage. The Windows manager encrypts its generated credentials; third-party provider configuration files remain in the private profile as required by those tools.

Local inference stays on the computer. Cloud inference shares prompts and requested file contents with the chosen endpoint and provider. Export backups regularly: deleting an application profile or clearing site data removes its workspace. Uninstalling MicoCode preserves its application data.

## Develop and build

Requires Node.js 22.13+. Desktop builds run on Windows x64.

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run build:web
npm run package:windows
```

Development runs at `http://127.0.0.1:5175`, workspace `/app/`. Windows builds appear in `release/`. Packaging downloads a pinned official Node 24 runtime, checks its SHA-256 digest, bundles web assets and local API handlers, and produces NSIS and portable executables. See `electron-builder.yml`; exact provider versions and archive checksums live in `desktop/artifacts.mjs`.

`npm run package:kit` retains the optional browser/Ollama relay kit, which requires separately installed Node and Ollama.

## Verification

`npm test` covers file protections, plan isolation, exact/partial edits, review, free model filtering, credential isolation, pacing, bounded retries, quota stops, cancellation, allowed native providers/engines, archive traversal/link rejection, and local server host/origin checks. TypeScript and production builds are checked too.

`node scripts/verify-desktop-providers.mjs build/provider-test` downloads official providers into an isolated test profile. Release checks installed 9Router, CLIProxyAPI, and LiteLLM, reused local Ollama, verified all four catalogues and idempotent reconnection, and received a real model response through 9Router's local route. Set `MICOCODE_VERIFY_GENERATION=1` for that generation probe.

A packaged executable smoke check verifies the actual renderer, native bridge, absence of renderer Node access, rejected arbitrary installer IDs, and local API responses. Browser checks cover theme selection/persistence, light/dark editors, dialogs, staged edits, apply/restore, preview scripts, console capture, and responsive layout. Browser model download and authenticated OpenRouter generation need suitable GPU hardware and an account key; they are not claimed as release-tested here.

## Credits

MicoCode uses React, CodeMirror, WebLLM, Electron, and Node.js. Managed providers are independent projects: [9Router](https://github.com/decolua/9router), [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI), [LiteLLM](https://github.com/BerriAI/litellm), [uv](https://github.com/astral-sh/uv), and [Ollama](https://github.com/ollama/ollama). Their licenses and service terms apply to their software and services.

MicoCode is independent software inspired by OpenCode and Antigravity, and is not affiliated with those products or the listed providers. MicoCode is MIT licensed.
