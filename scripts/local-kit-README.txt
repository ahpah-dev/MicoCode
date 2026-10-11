MicoCode local kit — v0.1
https://micocode.vercel.app
Source: https://github.com/ahpah-dev/MicoCode

This ZIP contains a small local inference relay, not a desktop application installer.
The MicoCode application opens in your browser.

1. Install Node.js 22+ from https://nodejs.org/en/download
2. Install and run Ollama from https://ollama.com/download
3. Install a coding model, for example: ollama pull qwen3.5:9b (or gemma4:26b, qwen3.8:27b, qwen3.6:27b-coding, devstral:24b)
   The model download uses several GB. Model quality and speed depend on your hardware.
4. Extract this ZIP to a folder.
5. Windows: double-click Start-MicoCode.cmd. Keep its window open.
   macOS / Linux: open a terminal in the folder and run: node micocode-proxy.mjs
   Then open https://micocode.vercel.app/app/
6. Allow local network access if your browser asks. MicoCode automatically detects
   the relay at http://127.0.0.1:11435 and selects an installed model.
   You can choose another model in Connections.

If automatic discovery fails, select Ollama in Connections, enter
http://127.0.0.1:11435 as the local address, and click Connect.

The relay listens only on this computer. It forwards model discovery and chat
to Ollama at http://127.0.0.1:11434. It does not expose shell commands or your files.
It permits only https://micocode.vercel.app and the local development origins.
For your own hosted copy: node micocode-proxy.mjs --origin https://your-site.example

Stop the relay with Ctrl+C. An existing Ollama service must stay running.
Local inference has no service quota. Optional cloud models have provider limits.
Export your projects regularly; they live in this browser's local storage.
