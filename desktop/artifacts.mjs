// Exact upstream releases and their published SHA-256 digests. No moving "latest" URLs at runtime.
export const artifacts={
 cliproxy:{version:'8.0.23',url:'https://github.com/router-for-me/CLIProxyAPI/releases/download/v8.0.23/CLIProxyAPI_8.0.23_windows_amd64.zip',sha256:'d2839470df9a3698c9b0a93a6f42f8c569be4a0f74099f7110ba9350f62ca6f7',maxBytes:35000000},
 freeride:{version:'0.4.0a24',url:'https://files.pythonhosted.org/packages/a5/0f/893eecb2198b6fbc4f312020d8cda753b63551de69095b51d3bb43f2478d/freeride_gateway-0.4.0a24-py3-none-any.whl',sha256:'e1cbea2fdb5a98e0a94d065e8e1f02b44986adb4261621fb23a76dd54419334b',maxBytes:2000000},
 uv:{version:'0.13.0',url:'https://github.com/astral-sh/uv/releases/download/0.13.0/uv-x86_64-pc-windows-msvc.zip',sha256:'088962f9e7b7bd9ea740c04c650b2a21c8928c345bd99ac24350dc924dba656c',maxBytes:25000000},
 ollama:{version:'0.40.2',url:'https://github.com/ollama/ollama/releases/download/v0.40.2/ollama-windows-amd64.zip',sha256:'e29ad1d5063dd4b54b2492d9b00adab2cff9621bfa654b6c92aa8d6f1fdfe7fc',maxBytes:1800000000},
 // GPT-Load's portable Windows build. Its own release publishes SHA256SUMS; this
 // digest is the one published there for gpt-load-windows-amd64.exe and was
 // re-checked against a fresh download.
 gptload:{version:'2.0.0-rc.49',url:'https://github.com/tbphp/gpt-load/releases/download/v2.0.0-rc.49/gpt-load-windows-amd64.exe',sha256:'1d558fb6cb0a27e9f28ead5e1d4410517d60513a98f58ac092835e2f6b7e4447',maxBytes:130000000},
 // Octopus ships one self-contained exe inside a zip. The digest is the one its
 // release publishes in SHA256SUMS and was re-checked against a fresh download.
 octopus:{version:'0.13.10',url:'https://github.com/bestruirui/octopus/releases/download/v0.13.10/octopus-windows-amd64.zip',sha256:'806a593848f211622bdc8d7e167cbe1507fea72b651edf3fd1f8d964674ee468',maxBytes:40000000},
};
export const versions={nine:'0.5.99',litellm:'1.104.2',freeride:'0.4.0a24',gptload:'2.0.0-rc.49',octopus:'0.13.10',python:'3.12',node:'24.21.0',model:'qwen3.5:9b'};
