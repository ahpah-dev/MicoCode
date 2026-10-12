import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {moveSelection, paletteKeyAction, workspaceShortcuts, typeaheadIndex, groupOptionsByPrefix} from '../lib/mico/interface.ts';

const source = p => readFileSync(fileURLToPath(new URL('../' + p, import.meta.url)), 'utf8');
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
const css = p => stripComments(source('app/' + p));

test('list highlight wraps at both ends and refuses an empty list', () => {
  assert.equal(moveSelection(0, 1, 3), 1);
  assert.equal(moveSelection(2, 1, 3), 0, 'ArrowDown on the last row wraps to the first');
  assert.equal(moveSelection(0, -1, 3), 2, 'ArrowUp on the first row wraps to the last');
  assert.equal(moveSelection(1, -1, 3), 0);
  // Nothing highlighted yet: the first press has to land on a real row.
  assert.equal(moveSelection(-1, 1, 3), 0);
  assert.equal(moveSelection(-1, -1, 3), 2);
  // Out-of-range and empty inputs must not produce a negative index.
  assert.equal(moveSelection(9, 1, 3), 0);
  assert.equal(moveSelection(0, 1, 0), -1);
  assert.equal(moveSelection(-1, -1, 0), -1);
});

test('quick-actions keys move, jump, and run — and leave typing alone', () => {
  assert.deepEqual(paletteKeyAction('ArrowDown', 0, 3), {type: 'move', index: 1});
  assert.deepEqual(paletteKeyAction('ArrowUp', 0, 3), {type: 'move', index: 2});
  assert.deepEqual(paletteKeyAction('Home', 2, 3), {type: 'move', index: 0});
  assert.deepEqual(paletteKeyAction('End', 0, 3), {type: 'move', index: 2});
  assert.deepEqual(paletteKeyAction('Enter', 1, 3), {type: 'run'});
  assert.equal(paletteKeyAction('Enter', -1, 0), null, 'Enter on an empty result list must not run anything');
  assert.equal(paletteKeyAction('Escape', 0, 3), null, 'Escape belongs to the dialog, not the list');
  for (const key of ['a', 'Backspace', 'Tab', 'ArrowLeft', ' ']) {
    assert.equal(paletteKeyAction(key, 0, 3), null, key + ' must stay a normal edit key');
  }
});

test('the quick actions are a labelled listbox with a roving highlight', () => {
  const palette = source('components/micocode/command-palette.tsx');
  for (const token of ['role="combobox"', 'role="listbox"', 'role="option"', 'aria-activedescendant', 'aria-selected', 'paletteKeyAction']) {
    assert.ok(palette.includes(token), 'command-palette.tsx is missing ' + token);
  }
  const polish = css('polish.css');
  assert.ok(polish.includes('.command-list button.active'), 'the highlighted row needs a visible treatment');
  assert.ok(polish.includes('.command-empty'), 'an empty result list needs its own message');
  assert.ok(source('components/micocode/workspace.tsx').includes('<CommandPalette'), 'the workspace must render the palette');
});

// The Help dialog and the key handler are written in different files. This fails
// the build when they drift apart, so the guide can never promise a dead key.
test('every documented shortcut is implemented exactly once in the key handler', () => {
  const workspace = source('components/micocode/workspace.tsx');
  const expected = {
    'Ctrl K': "key.toLowerCase()==='k'",
    'Ctrl O': "key.toLowerCase()==='o'",
    'Ctrl S': "key.toLowerCase()==='s'",
    'Ctrl B': "k==='b'",
    'Ctrl J': "k==='j'",
    'Ctrl ,': "k===','",
    'Ctrl ⇧ M': "e.shiftKey&&e.key.toLowerCase()==='m'",
    '/': "e.key==='/'",
    '↵': "e.key==='Enter'&&!e.shiftKey",
    '⇧ ↵': "e.key==='Enter'&&!e.shiftKey",
    'Esc': "e.key==='Escape'&&busy",
  };
  for (const shortcut of workspaceShortcuts) {
    assert.ok(expected[shortcut.keys], 'Help lists ' + shortcut.keys + ' but no handler contract covers it');
    assert.ok(workspace.includes(expected[shortcut.keys]), shortcut.keys + ' is listed in Help but not handled: ' + expected[shortcut.keys]);
  }
  assert.equal(Object.keys(expected).length, workspaceShortcuts.length, 'Help and the handler contracts have drifted apart');
  const help = source('components/micocode/workspace.tsx');
  assert.ok(help.includes('workspaceShortcuts.map'), 'the Help dialog must render the shared shortcut list');
});

// A backdrop-filter on ::backdrop makes Chromium composite the whole top layer
// through the filter, which washes out the dialog itself as well as the page
// behind it. The scrim is painted instead, so it renders the same everywhere.
test('the dialog scrim is painted, never blurred', () => {
  for (const file of ['globals.css', 'product.css', 'visual.css', 'polish.css']) {
    const body = css(file);
    for (const match of body.matchAll(/([^{}]*::backdrop[^{}]*)\{([^}]*)\}/g)) {
      assert.ok(!match[2].includes('backdrop-filter'), file + ' blurs ::backdrop on ' + match[1].trim());
    }
  }
  const visual = css('visual.css');
  const scrim = /\.modal::backdrop\{([^}]*)\}/.exec(visual);
  assert.ok(scrim, 'visual.css must own the one modal scrim');
  assert.ok(scrim[1].includes('radial-gradient'), 'the scrim must vignette so the dialog sits in the calm centre');
  assert.ok(!visual.includes('.modal::backdrop{background:color-mix'), 'the flat scrim was replaced by the vignette');
  // The dialog surface itself must stay opaque: legibility cannot depend on
  // whatever happens to be behind it.
  const modal = /\.modal\{([^}]*)\}/.exec(visual);
  assert.ok(modal && !modal[1].includes('transparent'), 'the modal surface must not be translucent');
});

test('changed files in Source Control are reachable by keyboard', () => {
  const git = source('components/micocode/git-panel.tsx');
  assert.ok(!/<div[^>]*className="git-file-row"/.test(git), 'a click-only div is not reachable by keyboard');
  assert.ok(git.includes('className="git-file-row"'), 'the changed-file rows disappeared');
  const buttons = git.match(/<button[\s\S]{0,240}?className="git-file-row"[\s\S]{0,240}?>/g) ?? [];
  assert.ok(buttons.length >= 3, 'staged, modified, and untracked rows must all be buttons, found ' + buttons.length);
  assert.ok(css('polish.css').includes('button.git-file-row'), 'the row must still read as a flat row, not as chrome');
});

test('streaming and status text is announced instead of only drawn', () => {
  const workspace = source('components/micocode/workspace.tsx');
  assert.ok(workspace.includes('role="log" aria-live="polite" aria-relevant="additions text" aria-busy'), 'the message stream needs a live region that reports busy state');
  assert.ok(/console-output" role="log" aria-live="polite"/.test(workspace), 'console output needs a live region');
  const preview = source('components/micocode/preview.tsx');
  assert.ok(/preview-console-body" role="log"/.test(preview), 'the preview console needs a live region');
});

test('icon-only controls carry an accessible name, not only a tooltip', () => {
  for (const file of ['components/micocode/workspace.tsx', 'components/micocode/git-panel.tsx', 'components/micocode/preview.tsx']) {
    const body = source(file);
    for (const match of body.matchAll(/<button\b[\s\S]{0,400}?>/g)) {
      const tag = match[0];
      if (!/\btitle=/.test(tag)) continue;
      const hasText = />[^<]*[A-Za-z0-9][^<]*</.test(tag);
      const named = /\baria-label(Name)?=/.test(tag);
      assert.ok(named || hasText, file + ' has a tooltip-only control: ' + tag.replace(/\s+/g, ' ').slice(0, 160));
    }
  }
});

test('Escape leaves the innermost surface first', () => {
  const preview = source('components/micocode/preview.tsx');
  const handler = /const handleKey=\(e:KeyboardEvent\)=>\{([\s\S]*?)\n\s*\};/.exec(preview);
  assert.ok(handler, 'preview key handler not found');
  assert.ok(handler[1].indexOf('inspecting') < handler[1].indexOf('consoleOpen'), 'element inspection must close before the console drawer');
  assert.ok(/\},\[inspecting,consoleOpen\]\)/.test(preview), 'the handler must re-subscribe when the drawer opens or closes');
});

// Managed routers install their own dashboard. Every one that needs a credential
// to sign in has to offer both buttons, and the credential must never be handed
// back to the renderer.
// The packaged-app smoke gate asserts one status row per managed provider. A
// literal there fails the whole release the next time a router is added.
test('the smoke gate counts providers from the managed list, not a literal', () => {
  const main = source('desktop/main.mjs');
  assert.match(main, /statusCount===managedProviders\.length/, 'adding a managed provider must not silently fail the smoke gate');
  assert.ok(main.includes('managedProviders'), 'the list must be the one the manager actually reports');
});

test('managed routers expose their dashboard and its sign-in credential', () => {
  const connections = source('components/micocode/connections.tsx');
  for (const id of ['octopus']) {
    assert.ok(connections.includes(`openDashboard('${id}')`), id + ' needs an Open dashboard button');
    assert.ok(connections.includes(`copyDashboardKey('${id}')`), id + ' needs a way to get its dashboard credential');
  }
  const main = source('desktop/main.mjs');
  assert.ok(main.includes("'mico:dashboard-key'"), 'the main process must expose the dashboard credential');
  assert.ok(main.includes('clipboard.writeText'), 'the credential must be copied in the main process, not the renderer');
  assert.ok(source('desktop/preload.cjs').includes('copyDashboardKey'), 'the preload bridge must forward the copy request');
});

test('typing in a dropdown finds the label and repeats cycle through matches', () => {
  const labels = ['Comfortable', 'Compact', 'Standard', 'Settings', 'Focused · 0.2'];
  assert.equal(typeaheadIndex(labels, 'c', 0), 0, 'from the top, "c" finds the first match');
  assert.equal(typeaheadIndex(labels, 'cc', 0), 1, 'a repeated letter advances to the next match');
  assert.equal(typeaheadIndex(labels, 'st', 0), 2, 'a longer prefix can skip earlier single-letter matches');
  assert.equal(typeaheadIndex(labels, 'se', 2), 3, 'a long prefix reaches a later option');
  assert.equal(typeaheadIndex(labels, 'f', 0), 4, 'case does not matter, and searching wraps');
  assert.equal(typeaheadIndex(labels, 'zz', 0), -1, 'no match reports -1 instead of guessing');
  assert.equal(typeaheadIndex([], 'c', 0), -1);
  assert.equal(typeaheadIndex(labels, '', 0), -1);
  assert.equal(typeaheadIndex(labels, 'c', -5), 0, 'an out-of-range start still searches the whole list');
});

test('grouping dropdown options follows the provider prefix, like the model menu', () => {
  const groups = groupOptionsByPrefix([
    {value: 'openrouter/free', label: 'Auto'},
    {value: 'google/gemma-4-31b:free', label: 'Gemma 4 31B'},
    {value: 'google/gemma-4-26b:free', label: 'Gemma 4 26B'},
    {value: 'meta-llama/llama-4:free', label: 'Llama 4'},
    {value: 'no-prefix', label: 'Plain'},
  ]);
  assert.deepEqual(groups.map(g => g.label), ['openrouter', 'google', 'meta-llama', 'Other']);
  assert.equal(groups[1].options.length, 2, 'options sharing a prefix share a group');
  assert.deepEqual(groups[1].options.map(o => o.label), ['Gemma 4 31B', 'Gemma 4 26B'], 'order inside a group is preserved');
  assert.equal(groups[3].options[0].value, 'no-prefix');
  assert.deepEqual(groupOptionsByPrefix([]), []);
});

// The whole point of the shared dropdown is that native selects stop being used,
// because their popup cannot be themed. This fails the build if one returns.
test('no native select survives in the workspace; every dropdown is the shared one', () => {
  const dir = fileURLToPath(new URL('../components/micocode/', import.meta.url));
  const files = readdirSync(dir).filter(name => name.endsWith('.tsx') && !name.startsWith('dropdown.'));
  const withSelect = files.filter(name => /<select[\s>]/.test(source('components/micocode/' + name)));
  assert.deepEqual(withSelect, [], 'native <select> cannot be styled to match the model menu');

  const dropdown = source('components/micocode/dropdown.tsx');
  for (const token of ['role="combobox"', 'role="listbox"', 'role="option"', 'aria-activedescendant', 'aria-selected', 'paletteKeyAction', 'typeaheadIndex']) {
    assert.ok(dropdown.includes(token), 'dropdown.tsx is missing ' + token);
  }
  for (const name of ['workspace.tsx', 'connections.tsx', 'preview.tsx', 'plugins-dialog.tsx']) {
    const body = source('components/micocode/' + name);
    assert.ok(body.includes("from './dropdown'"), name + ' must use the shared Dropdown');
    assert.ok(/<Dropdown\b/.test(body), name + ' imports Dropdown but never renders one');
  }
});

test('the dropdown surface is the model menu surface, shared and opaque', () => {
  const polish = css('polish.css');
  const shared = /\.dropdown-menu,\.model-menu\{([^}]*)\}/.exec(polish);
  assert.ok(shared, 'polish.css must declare the menu surface for both families in one rule');
  assert.ok(shared[1].includes('background:var(--tone-10)'), 'the menu surface must be an opaque panel');
  assert.ok(!shared[1].includes('transparent'), 'an opaque menu must not paint a translucent background');
  assert.ok(shared[1].includes('backdrop-filter:none'), 'the opaque menu must not ask for a backdrop root');
  assert.ok(shared[1].includes('box-shadow:var(--shadow-pop)'), 'the menu must sit on the app shadow');

  // Rows, group headings and the empty state are shared too, so they cannot drift.
  for (const pair of ['.dropdown-option,.model-option{', '.dropdown-group,.model-group{', '.dropdown-empty,.model-empty{']) {
    assert.ok(polish.includes(pair), 'polish.css must share ' + pair);
  }
  assert.ok(polish.includes('.dropdown-trigger{'), 'the closed control needs its own field styling');
  assert.ok(polish.includes('.dropdown-trigger:focus-visible'), 'the trigger needs a visible focus ring');
  assert.ok(polish.includes('.address .dropdown-trigger'), 'the preview address bar needs its quiet variant');
  assert.ok(polish.includes(':root[data-ui-text="large"] .dropdown-trigger'), 'text size must reach the dropdown');
  assert.ok(polish.includes(':root[data-ui-density="compact"] .dropdown-trigger'), 'density must reach the dropdown');
});
