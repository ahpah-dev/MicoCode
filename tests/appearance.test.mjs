import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const app = n => readFileSync(fileURLToPath(new URL('../app/' + n, import.meta.url)), 'utf8');
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = hex => {
  const [r, g, b] = hexToRgb(hex).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + .05) / (lo + .05);
};

function tokens(selector) {
  const css = app('semantic.css');
  const block = [...css.matchAll(/(:root[^{]*?)\{([^}]*)\}/g)]
    .find(m => m[1].includes(selector));
  assert.ok(block, 'missing token block for ' + selector);
  const vars = {};
  for (const m of block[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

// Status colors used to be hardcoded dark values, which left the Paper theme's
// console error text at 1.58:1 against its light panel.
const FORBIDDEN = ['#392c22', '#604a36', '#d7bfa6', '#dfba8c', '#e8a9a2', '#e0c08d', '#352e22', '#605035', '#3a3424', '#685d37', '#e1d39a', '#d8bc83', '#4c4129', '#673b34', '#d6998b', '#e8d097', '#d5b793', '#4a3422'];

test('status colors resolve from theme tokens instead of hardcoded values', () => {
  for (const file of ['globals.css', 'product.css']) {
    const code = stripComments(app(file));
    for (const color of FORBIDDEN) {
      assert.ok(!code.includes(color), file + ' still hardcodes status color ' + color);
    }
  }
});

test('every semantic ink is readable on its surface in dark themes and Paper', () => {
  const pairs = [
    ['danger-ink', 'danger-surface'], ['danger-ink', 'danger-surface-strong'],
    ['danger-ink-strong', 'danger-surface-strong'],
    ['warn-ink', 'warn-surface'], ['warn-ink', 'warn-surface-strong'],
    ['warn-ink-strong', 'warn-surface-strong'],
    ['success-ink', 'success-surface'],
    ['diff-add-ink', 'diff-add-surface'], ['diff-remove-ink', 'diff-remove-surface'],
  ];
  for (const [label, selector] of [['forest', 'forest'], ['paper', 'paper']]) {
    const vars = tokens(selector);
    for (const [ink, surface] of pairs) {
      assert.ok(vars[ink], label + ' is missing --' + ink);
      assert.ok(vars[surface], label + ' is missing --' + surface);
      const ratio = contrast(vars[ink], vars[surface]);
      assert.ok(ratio >= 4.5, label + ' --' + ink + ' on --' + surface + ' is ' + ratio.toFixed(2) + ':1');
    }
  }
});

// The console and editor paint status text straight onto the panel, so the
// ink has to hold up against the theme's own background, not a danger surface.
test('status ink stays legible on the plain panel in the light theme', () => {
  const paper = tokens('paper');
  const globals = stripComments(app('globals.css'));
  // Read Paper's real panel colour from its hsl() value rather than hardcoding it.
  const tone = new RegExp(':root\\[data-theme="paper"\\]\\{[^}]*--tone-10:hsl\\(\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%\\)').exec(globals);
  assert.ok(tone, 'Paper must define --tone-10 as hsl()');
  const hslToHex = (h, s, l) => {
    const sat = s / 100, lum2 = l / 100;
    const k = n => (n + h / 30) % 12;
    const a = sat * Math.min(lum2, 1 - lum2);
    const f = n => lum2 - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  };
  const panel = hslToHex(Number(tone[1]), Number(tone[2]), Number(tone[3]));
  for (const ink of ['danger-ink', 'warn-ink', 'diff-add-ink', 'diff-remove-ink']) {
    const ratio = contrast(paper[ink], panel);
    assert.ok(ratio >= 4.5, 'Paper --' + ink + ' on panel ' + panel + ' is ' + ratio.toFixed(2) + ':1');
  }
});

test('each theme declares its own color scheme so form controls match', () => {
  const globals = stripComments(app('globals.css'));
  for (const [theme, scheme] of [['graphite', 'dark'], ['midnight', 'dark'], ['violet', 'dark'], ['paper', 'light']]) {
    const rule = new RegExp(`:root\\[data-theme="${theme}"\\]\\{[^}]*color-scheme:${scheme};`).test(globals);
    assert.ok(rule, theme + ' must declare color-scheme:' + scheme);
  }
});