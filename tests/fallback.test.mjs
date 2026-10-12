import test from 'node:test';
import assert from 'node:assert/strict';
import {getFallbackCandidates,isRecoverableProviderError,CASCADE_PRESETS} from '../lib/mico/fallback.ts';
import {complete} from '../lib/mico/agent.ts';
import {credentialSlot,proxyPresets,writeCredential} from '../lib/mico/providers.mjs';
import {defaultConfig} from '../lib/mico/types.ts';

test('isRecoverableProviderError classifies transient and quota errors but never AbortError', () => {
  assert.equal(isRecoverableProviderError(new DOMException('User stopped', 'AbortError')), false);
  assert.equal(isRecoverableProviderError({name:'AbortError'}), false);
  assert.equal(isRecoverableProviderError({status:429}), true);
  assert.equal(isRecoverableProviderError({status:402}), true);
  assert.equal(isRecoverableProviderError({status:503}), true);
  assert.equal(isRecoverableProviderError({status:504}), true);
  assert.equal(isRecoverableProviderError({exhausted:true}), true);
  assert.equal(isRecoverableProviderError({message:'Resource has been exhausted (e.g. check quota)'}), true);
  assert.equal(isRecoverableProviderError({message:'Provider rate limit reached'}), true);
  assert.equal(isRecoverableProviderError({message:'Server overloaded, please retry'}), true);
  assert.equal(isRecoverableProviderError({message:'Syntax error in page'}), false);
  assert.equal(isRecoverableProviderError(null), false);
});

test('getFallbackCandidates cascades in the requested order: opencode -> aihubmix -> aistudio -> nim -> openrouter -> ollama', () => {
  const store = new Map();
  const mockStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  // Preset keys
  const opencodePreset = proxyPresets.find(p => p.id === 'opencode');
  const aihubmixPreset = proxyPresets.find(p => p.id === 'aihubmix');
  const aistudioPreset = proxyPresets.find(p => p.id === 'aistudio');
  const nimPreset = proxyPresets.find(p => p.id === 'nim');

  mockStorage.setItem(credentialSlot({provider:'proxy',proxyPreset:'opencode',proxyUrl:opencodePreset.url}), 'oc-zen-key-1');
  mockStorage.setItem(credentialSlot({provider:'proxy',proxyPreset:'aihubmix',proxyUrl:aihubmixPreset.url}), 'sk-aihubmix-key-2');
  mockStorage.setItem(credentialSlot({provider:'proxy',proxyPreset:'aistudio',proxyUrl:aistudioPreset.url}), 'AIzaSy-key-3');
  mockStorage.setItem(credentialSlot({provider:'proxy',proxyPreset:'nim',proxyUrl:nimPreset.url}), 'nvapi-key-4');
  mockStorage.setItem(credentialSlot({provider:'openrouter'}), 'sk-or-key-5');
  mockStorage.setItem('mico-profiles:v1', JSON.stringify({'ollama': {model:'qwen3.5:9b'}}));

  // When current is opencode:
  const current = {...defaultConfig, provider:'proxy', proxyPreset:'opencode', proxyUrl:opencodePreset.url, model:'muse-spark-1.3'};
  const candidates = getFallbackCandidates(current, 'oc-zen-key-1', mockStorage);

  assert.deepEqual(candidates.map(c => c.id), ['aihubmix', 'aistudio', 'nim', 'openrouter', 'ollama']);
  assert.equal(candidates[0].key, 'sk-aihubmix-key-2');
  assert.equal(candidates[1].key, 'AIzaSy-key-3');
  assert.equal(candidates[2].key, 'nvapi-key-4');
  assert.equal(candidates[3].key, 'sk-or-key-5');
});

test('complete() cascades automatically on 429 rate limit or quota errors across configured providers', async () => {
  const opencodePreset = proxyPresets.find(p => p.id === 'opencode');
  const aihubmixPreset = proxyPresets.find(p => p.id === 'aihubmix');

  // Save AIHubMix credential in mock environment
  writeCredential({provider:'proxy',proxyPreset:'aihubmix',proxyUrl:aihubmixPreset.url}, 'sk-aihubmix-fallback-key');

  const priorFetch = globalThis.fetch;
  const calls = [];
  const statusUpdates = [];

  globalThis.fetch = async (url, options) => {
    calls.push(url);
    if (url === '/api/opencode') {
      return Response.json({error: 'OpenCode Zen rate limit reached (429). Wait for reset or try another model.'}, {status: 429});
    }
    if (url === '/api/aihubmix') {
      return Response.json({choices:[{message:{content:'{"message":"Saved via AIHubMix fallback","actions":[],"done":true}'},finish_reason:'stop'}]});
    }
    return Response.json({error:'Not found'}, {status: 404});
  };

  try {
    const config = {
      ...defaultConfig,
      provider: 'proxy',
      proxyPreset: 'opencode',
      proxyUrl: opencodePreset.url,
      model: 'muse-spark-1.3',
      freeFallback: true,
      resilience: false,
    };

    const result = await complete(
      [{role:'user',content:'Build website'}],
      config,
      'oc-key-test',
      new AbortController().signal,
      () => {},
      (status) => statusUpdates.push(status)
    );

    assert.match(result, /Saved via AIHubMix fallback/);
    assert.deepEqual(calls, ['/api/opencode', '/api/aihubmix']);
    assert.ok(statusUpdates.some(s => s.includes('OpenCode Zen reached a limit') && s.includes('Instant fallback to AIHubMix')));
  } finally {
    globalThis.fetch = priorFetch;
    writeCredential({provider:'proxy',proxyPreset:'aihubmix',proxyUrl:aihubmixPreset.url}, '');
  }
});

test('isRecoverableProviderError recognizes router reachability, CORS, and network errors', () => {
  assert.equal(isRecoverableProviderError({message:'The router could not be reached. Check the address, CORS, and network connection.'}), true);
  assert.equal(isRecoverableProviderError({message:'TypeError: Failed to fetch'}), true);
  assert.equal(isRecoverableProviderError({message:'ECONNREFUSED 127.0.0.1:20128'}), true);
  assert.equal(isRecoverableProviderError({message:'connect ECONNREFUSED'}), true);
});

test('getFallbackCandidates allows 9Router to cascade to configured providers and local Ollama', () => {
  const store = new Map();
  const mockStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const ninePreset = proxyPresets.find(p => p.id === '9router');
  const aihubmixPreset = proxyPresets.find(p => p.id === 'aihubmix');
  const aistudioPreset = proxyPresets.find(p => p.id === 'aistudio');

  mockStorage.setItem(credentialSlot({provider:'proxy',proxyPreset:'9router',proxyUrl:ninePreset.url}), 'sk-nine-key');
  mockStorage.setItem(credentialSlot({provider:'proxy',proxyPreset:'aihubmix',proxyUrl:aihubmixPreset.url}), 'sk-aihubmix-key');
  mockStorage.setItem(credentialSlot({provider:'proxy',proxyPreset:'aistudio',proxyUrl:aistudioPreset.url}), 'AIzaSy-studio-key');
  mockStorage.setItem('mico-profiles:v1', JSON.stringify({'ollama': {model:'gemma4:gpu'}}));

  const current = {...defaultConfig, provider:'proxy', proxyPreset:'9router', proxyUrl:ninePreset.url, model:'kimchi/kimi-k3'};
  const candidates = getFallbackCandidates(current, 'sk-nine-key', mockStorage);

  assert.deepEqual(candidates.map(c => c.id), ['aihubmix', 'aistudio', 'ollama']);
  assert.equal(candidates[0].key, 'sk-aihubmix-key');
  assert.equal(candidates[1].key, 'AIzaSy-studio-key');
  assert.equal(candidates[2].config.model, 'gemma4:gpu');
});

test('complete() cascades from 9Router on upstream error or unreachable router to Local Ollama', async () => {
  const ninePreset = proxyPresets.find(p => p.id === '9router');
  const priorFetch = globalThis.fetch;
  const calls = [];
  const statusUpdates = [];

  const origStorage = globalThis.localStorage;
  const store = new Map();
  store.set('mico-profiles:v1', JSON.stringify({ollama: {model:'gemma4:gpu', ollamaUrl:'http://127.0.0.1:11434'}}));
  globalThis.localStorage = {
    getItem: k => store.get(k) || null,
    setItem: (k,v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };

  globalThis.fetch = async (url, options) => {
    calls.push(url);
    if (url.includes('20128')) {
      return Response.json({
        error: { message: '[kimchi/kimi-k3] [402]: the provider for model kimi-k3 has exhausted its credits' }
      }, { status: 503 });
    }
    if (url.includes('11434')) {
      return Response.json({
        message: { content: '{"message":"Generated via Local Ollama fallback","actions":[],"done":true}' }
      });
    }
    return Response.json({ error: 'Not found' }, { status: 404 });
  };

  try {
    const config = {
      ...defaultConfig,
      provider: 'proxy',
      proxyPreset: '9router',
      proxyUrl: ninePreset.url,
      model: 'kimchi/kimi-k3',
      freeFallback: true,
      resilience: false,
    };

    const result = await complete(
      [{role:'user',content:'Build an app'}],
      config,
      'sk-test-nine',
      new AbortController().signal,
      () => {},
      (status) => statusUpdates.push(status)
    );

    assert.match(result, /Generated via Local Ollama fallback/);
    assert.ok(calls.some(u => u.includes('20128')));
    assert.ok(calls.some(u => u.includes('11434')));
    assert.ok(statusUpdates.some(s => s.includes('9Router reached a limit') && s.includes('Instant fallback to Local Ollama')));
  } finally {
    globalThis.fetch = priorFetch;
    globalThis.localStorage = origStorage;
  }
});
