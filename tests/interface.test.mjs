import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_DEFAULT,
  AGENT_MAX,
  AGENT_MIN,
  CONSOLE_DEFAULT,
  CONSOLE_MAX,
  CONSOLE_MIN,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  applyInterfacePrefs,
  clampPanelWidth,
  defaultInterfacePrefs,
  normalizeInterfacePrefs,
  normalizePanelWidths,
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

test('panel widths clamp into range and reject garbage', () => {
  assert.equal(clampPanelWidth(200, SIDEBAR_MIN, SIDEBAR_MAX), 200);
  assert.equal(clampPanelWidth(50, SIDEBAR_MIN, SIDEBAR_MAX), SIDEBAR_MIN);
  assert.equal(clampPanelWidth(9999, SIDEBAR_MIN, SIDEBAR_MAX), SIDEBAR_MAX);
  assert.equal(clampPanelWidth('oops', SIDEBAR_MIN, SIDEBAR_MAX), null);
  assert.equal(clampPanelWidth(undefined, AGENT_MIN, AGENT_MAX), null);
  assert.equal(clampPanelWidth(400.4, AGENT_MIN, AGENT_MAX), 400);
  assert.equal(clampPanelWidth(5, CONSOLE_MIN, CONSOLE_MAX), CONSOLE_MIN);
  assert.deepEqual(normalizePanelWidths(undefined), {sidebarWidth: null, agentWidth: null, consoleHeight: null});
  assert.deepEqual(normalizePanelWidths({sidebarWidth: 240, agentWidth: 10, consoleHeight: 900}), {sidebarWidth: 240, agentWidth: AGENT_MIN, consoleHeight: CONSOLE_MAX});
  assert.ok(SIDEBAR_DEFAULT >= SIDEBAR_MIN && SIDEBAR_DEFAULT <= SIDEBAR_MAX);
  assert.ok(AGENT_DEFAULT >= AGENT_MIN && AGENT_DEFAULT <= AGENT_MAX);
  assert.ok(CONSOLE_DEFAULT >= CONSOLE_MIN && CONSOLE_DEFAULT <= CONSOLE_MAX);
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
    '.resize-handle',
    '.resize-handle:focus-visible::after',
    ':root[data-agent-side="left"] .agent-panel>.resize-handle',
    'select{appearance:none',
    'select option{background:var(--tone-15)',
  ]) {
    assert.ok(css.includes(selector), 'product.css is missing ' + selector);
  }
});

test('form controls inherit the theme color scheme instead of forcing dark', async () => {
  const {readFileSync} = await import('node:fs');
  const {fileURLToPath} = await import('node:url');
  const globals = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');
  assert.ok(globals.includes('select{color-scheme:inherit}'), 'select must inherit the per-theme color scheme');
  assert.ok(!globals.replace(/\/\*[\s\S]*?\*\//g, '').includes('select{color-scheme:dark}'), 'hardcoded dark select scheme remains');
});
