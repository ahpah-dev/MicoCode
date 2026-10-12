import {readCredential,recallProfile,proxyPresets} from './providers.mjs';
import type {Config} from './types';

export type FallbackCandidate = {
  id: string;
  name: string;
  config: Config;
  key: string;
};

// The instant-fallback chain. A candidate's model is only ever one of two things:
// a route MicoCode itself owns (a stable alias that cannot go stale), or the model
// the user already chose for that provider. An empty defaultModel means "only use
// this provider if the user has used it before" — the chain must never name a
// third-party model on the user's behalf, because that is how a workspace ends up
// quietly falling back to a model two generations old.
export const CASCADE_PRESETS: Array<{id: string; name: string; defaultModel: string; preset?: Config['proxyPreset']}> = [
  {id:'opencode', name:'OpenCode Zen', defaultModel:'', preset:'opencode'},
  {id:'aihubmix', name:'AIHubMix', defaultModel:'', preset:'aihubmix'},
  {id:'aistudio', name:'Google AI Studio', defaultModel:'', preset:'aistudio'},
  {id:'nim', name:'NVIDIA NIM', defaultModel:'', preset:'nim'},
  // MicoCode's own managed routes: these aliases always resolve to whatever the
  // router currently offers, so they stay current without naming a model.
  {id:'9router', name:'9Router', defaultModel:'mico-free/free-code', preset:'9router'},
  {id:'litellm', name:'LiteLLM', defaultModel:'', preset:'litellm'},
  {id:'cliproxy', name:'CLIProxyAPI', defaultModel:'', preset:'cliproxy'},
  {id:'openrouter', name:'OpenRouter', defaultModel:'openrouter/free'},
  {id:'ollama', name:'Local Ollama', defaultModel:'qwen3.5:9b'},
];

export function getFallbackCandidates(currentConfig: Config, currentKey?: string, storage?: any): FallbackCandidate[] {
  const currentKeyNormalized = (currentKey || '').trim();
  const currentSlot = currentConfig.provider === 'proxy' ? currentConfig.proxyPreset : currentConfig.provider;
  const candidates: FallbackCandidate[] = [];

  for (const item of CASCADE_PRESETS) {
    if (item.id === currentSlot) continue;
    if (item.preset) {
      const presetObj = proxyPresets.find(p => p.id === item.preset);
      if (!presetObj) continue;
      const base: Config = {
        ...currentConfig,
        provider: 'proxy',
        proxyPreset: item.preset,
        proxyUrl: presetObj.url,
        managed: false,
        freeModels: [],
        routerFreeOnly: false,
        model: item.defaultModel,
      };
      const key = readCredential(base, storage).trim();
      if (!key) continue;
      const saved = recallProfile(base, storage);
      let model = (typeof saved?.model === 'string' && saved.model.trim()) ? saved.model.trim() : item.defaultModel;
      if (item.preset === 'opencode' && model.startsWith('oc/')) model = model.slice(3);
      // An empty model is deliberate: the caller asks the provider for its current
      // catalogue when it reaches it. Guessing a name here is how a workspace ends
      // up quietly falling back to a model two generations old.
      candidates.push({
        id: item.id,
        name: item.name,
        config: {...base, model},
        key,
      });
    } else if (item.id === 'openrouter') {
      const base: Config = {
        ...currentConfig,
        provider: 'openrouter',
        model: 'openrouter/free',
      };
      const key = readCredential(base, storage).trim();
      if (!key) continue;
      const saved = recallProfile(base, storage);
      const model = (typeof saved?.model === 'string' && saved.model.trim()) ? saved.model.trim() : 'openrouter/free';
      candidates.push({
        id: 'openrouter',
        name: 'OpenRouter',
        config: {...base, model},
        key,
      });
    } else if (item.id === 'ollama') {
      const saved = recallProfile({provider:'ollama', ollamaUrl: currentConfig.ollamaUrl || 'http://127.0.0.1:11434', model: ''}, storage);
      const url = saved?.ollamaUrl || currentConfig.ollamaUrl || 'http://127.0.0.1:11434';
      let model = (typeof saved?.model === 'string' && saved.model.trim()) ? saved.model.trim() : (currentConfig.provider === 'ollama' && currentConfig.model ? currentConfig.model : '');
      if (!model && (storage?.getItem?.('mico-ollama-model') || (typeof globalThis.window !== 'undefined' && (currentConfig.ollamaUrl || (globalThis.window as any)?.micoDesktop)))) {
        model = item.defaultModel || 'gemma4:gpu';
      }
      if (!model) continue;
      const base: Config = {
        ...currentConfig,
        provider: 'ollama',
        ollamaUrl: url,
        model,
      };
      candidates.push({
        id: 'ollama',
        name: 'Local Ollama',
        config: base,
        key: '',
      });
    }
  }

  return candidates;
}

export function isRecoverableProviderError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as {status?: number; name?: string; message?: string; exhausted?: boolean; cause?: unknown};
  if (e.name === 'AbortError') return false;
  if (e.exhausted) return true;
  if ([401, 402, 403, 404, 429, 500, 502, 503, 504].includes(Number(e.status))) return true;
  const msg = String(e.message || '');
  return /quota|limit|credit|exhaust|unauthorized|forbidden|rate limit|busy|overloaded|timeout|econnrefused|not responding|could not be reached|failed to fetch|cors|network|connection refused/i.test(msg);
}
