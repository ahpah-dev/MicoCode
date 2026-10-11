import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  applyInterfacePrefs,
  defaultInterfacePrefs,
  normalizeInterfacePrefs,
  resolveInterface,
} from '../lib/mico/interface.ts';

test('saved interface values normalize to safe prefs', () => {
  assert.deepEqual(normalizeInterfacePrefs(undefined), defaultInterfacePrefs);
  assert.deepEqual(normalizeInterfacePrefs(null), defaultInterfacePrefs);
  assert.deepEqual(
    normalizeInterfacePrefs({density: 'compact', textSize: 'large', editorFont: 16, reduceMotion: true, agentSide: 'left', showTips: false}),
    {density: 'compact', textSize: 'large', editorFont: 16, reduceMotion: true, agentSide: 'left', showTips: false},
  );
});

test('unknown or out-of-range values fall back instead of breaking layout', () => {
  assert.deepEqual(
    normalizeInterfacePrefs({density: 'cozy', textSize: 'huge', editorFont: 99, agentSide: 'top', reduceMotion: 'yes', showTips: 1}),
    {density: 'comfortable', textSize: 'standard', editorFont: 18, reduceMotion: false, agentSide: 'right', showTips: true},
  );
  assert.equal(normalizeInterfacePrefs({editorFont: 4}).editorFont, 11);
  assert.equal(normalizeInterfacePrefs({editorFont: 'abc'}).editorFont, 13);
  assert.equal(normalizeInterfacePrefs({editorFont: 14.6}).editorFont, 15);
});

test('prefs resolve to document state the CSS can key off', () => {
  assert.deepEqual(resolveInterface(defaultInterfacePrefs), {
    dataset: {density: 'comfortable', text: 'standard', motion: 'full', agent: 'right'},
    style: {'--editor-font-size': '13px'},
  });
  const resolved = resolveInterface({...defaultInterfacePrefs, density: 'compact', reduceMotion: true, agentSide: 'left', editorFont: 16});
  assert.equal(resolved.dataset.density, 'compact');
  assert.equal(resolved.dataset.motion, 'reduce');
  assert.equal(resolved.dataset.agent, 'left');
  assert.equal(resolved.style['--editor-font-size'], '16px');
});

test('applying prefs without a document never throws', () => {
  assert.doesNotThrow(() => applyInterfacePrefs(defaultInterfacePrefs));
});

test('the stylesheet honors every preference the settings UI offers', async () => {
  const {readFileSync} = await import('node:fs');
  const {fileURLToPath} = await import('node:url');
  const css = readFileSync(fileURLToPath(new URL('../app/product.css', import.meta.url)), 'utf8');
  for (const selector of [
    ':root{--editor-font-size:13px}',
    ':root[data-ui-density="compact"] .topbar',
    ':root[data-ui-density="compact"] .agent-panel',
    ':root[data-ui-text="large"] .message-text',
    ':root[data-ui-motion="reduce"]',
    ':root[data-agent-side="left"] .workspace-layout .agent-panel',
    '.onboarding li.current',
    '.onboarding li.done .onboarding-step',
    '.check-toggle.on>span',
    '.interface-settings',
  ]) {
    assert.ok(css.includes(selector), 'product.css is missing ' + selector);
  }
});
