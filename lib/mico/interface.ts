export type UiDensity = 'comfortable' | 'compact';
export type UiTextSize = 'standard' | 'large';
export type AgentSide = 'right' | 'left';

export type InterfacePrefs = {
  density: UiDensity;
  textSize: UiTextSize;
  editorFont: number;
  reduceMotion: boolean;
  agentSide: AgentSide;
  showTips: boolean;
};

export const defaultInterfacePrefs: InterfacePrefs = {
  density: 'comfortable',
  textSize: 'standard',
  editorFont: 13,
  reduceMotion: false,
  agentSide: 'right',
  showTips: true,
};

const EDITOR_MIN = 11;
const EDITOR_MAX = 18;

function densityOf(v: unknown): UiDensity {
  return v === 'compact' ? 'compact' : 'comfortable';
}

function textSizeOf(v: unknown): UiTextSize {
  return v === 'large' ? 'large' : 'standard';
}

function editorFontOf(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return defaultInterfacePrefs.editorFont;
  return Math.min(EDITOR_MAX, Math.max(EDITOR_MIN, Math.round(n)));
}

function agentSideOf(v: unknown): AgentSide {
  return v === 'left' ? 'left' : 'right';
}

function booleanOf(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** Merge saved values over the defaults so old or hand-edited configs stay usable. */
export function normalizeInterfacePrefs(value: unknown): InterfacePrefs {
  const v = (value ?? {}) as Partial<InterfacePrefs>;
  return {
    density: densityOf(v.density),
    textSize: textSizeOf(v.textSize),
    editorFont: editorFontOf(v.editorFont),
    reduceMotion: booleanOf(v.reduceMotion, false),
    agentSide: agentSideOf(v.agentSide),
    showTips: booleanOf(v.showTips, true),
  };
}

export type InterfacePresentation = {
  dataset: {density: UiDensity; text: UiTextSize; motion: 'full' | 'reduce'; agent: AgentSide};
  style: {'--editor-font-size': string};
};

/** Adapt the Config field names to prefs, so saved configs stay forward-compatible. */
export function interfacePrefsFromConfig(config: {
  uiDensity?: unknown; uiTextSize?: unknown; editorFont?: unknown;
  reduceMotion?: unknown; agentSide?: unknown; showTips?: unknown;
}): InterfacePrefs {
  return normalizeInterfacePrefs({
    density: config.uiDensity,
    textSize: config.uiTextSize,
    editorFont: config.editorFont,
    reduceMotion: config.reduceMotion,
    agentSide: config.agentSide,
    showTips: config.showTips,
  });
}

export const SIDEBAR_MIN = 160;
export const SIDEBAR_MAX = 360;
export const SIDEBAR_DEFAULT = 215;
export const AGENT_MIN = 280;
export const AGENT_MAX = 560;
export const AGENT_DEFAULT = 355;
export const CONSOLE_MIN = 90;
export const CONSOLE_MAX = 420;
export const CONSOLE_DEFAULT = 185;

/** Clamp a saved width into range, or null when it was never set. */
export function clampPanelWidth(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Wrap-around movement for a single-column list. A negative index means
 *  "nothing highlighted yet", so the first press lands on an end of the list.
 *  Returns -1 when there is nothing to highlight. */
export function moveSelection(index: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  const start = index < 0 || index >= count ? (delta > 0 ? -1 : 0) : index;
  return (start + delta + count) % count;
}

export type PaletteKeyResult = {type: 'move'; index: number} | {type: 'run'} | null;

/** Map a key pressed inside the quick-actions search field onto a list action.
 *  Escape is intentionally absent: the dialog itself already handles it. */
export function paletteKeyAction(key: string, index: number, count: number): PaletteKeyResult {
  if (key === 'ArrowDown') return {type: 'move', index: moveSelection(index, 1, count)};
  if (key === 'ArrowUp') return {type: 'move', index: moveSelection(index, -1, count)};
  if (key === 'Home') return {type: 'move', index: count ? 0 : -1};
  if (key === 'End') return {type: 'move', index: count - 1};
  if (key === 'Enter') return count ? {type: 'run'} : null;
  return null;
}

/** Jump to the first option whose label starts with what has been typed.
 *  Pressing the same letter again cycles through the options that share it, and
 *  a longer prefix replaces the cycling so "se" can find "Settings". */
export function typeaheadIndex(labels: string[], query: string, from: number): number {
  const raw = query.trim();
  if (!labels.length || !raw) return -1;
  const cycling = raw.length > 1 && raw.split('').every(char => char === raw[0]);
  const needle = (cycling ? raw[0] : raw).toLowerCase();
  const start = from < 0 || from >= labels.length ? 0 : from;
  for (let step = 0; step < labels.length; step++) {
    const index = (start + step + (cycling ? 1 : 0)) % labels.length;
    if (labels[index].toLowerCase().startsWith(needle)) return index;
  }
  return -1;
}

/** Group a flat option list by the segment before the first "/" in its value,
 *  which is how router catalogues name their providers. Options with no prefix
 *  land in a trailing "Other" group, in the order they were given. */
export function groupOptionsByPrefix<T extends {value: string}>(options: T[]): {label: string; options: T[]}[] {
  const groups: {label: string; options: T[]}[] = [];
  for (const option of options) {
    const slash = option.value.indexOf('/');
    const label = slash > 0 ? option.value.slice(0, slash) : 'Other';
    const group = groups.find(candidate => candidate.label === label);
    if (group) group.options.push(option);
    else groups.push({label, options: [option]});
  }
  return groups;
}

/** The keys the workspace implements, listed in Help so they can be discovered
 *  rather than guessed. Kept next to the prefs so the guide and the handler
 *  cannot drift apart silently. */
export const workspaceShortcuts: {keys: string; label: string}[] = [
  {keys: 'Ctrl K', label: 'Quick actions'},
  {keys: 'Ctrl O', label: 'Open a folder'},
  {keys: 'Ctrl S', label: 'Save the workspace locally'},
  {keys: 'Ctrl B', label: 'Show or hide the file explorer'},
  {keys: 'Ctrl J', label: 'Show or hide the console'},
  {keys: 'Ctrl ⇧ M', label: 'Show or hide the Mico panel'},
  {keys: 'Ctrl ,', label: 'Appearance and settings'},
  {keys: '/', label: 'Jump to the message box'},
  {keys: '↵', label: 'Send a message'},
  {keys: '⇧ ↵', label: 'Add a line instead of sending'},
  {keys: 'Esc', label: 'Stop a run that is in progress'},
];

/** Saved panel sizes survive only when they are usable numbers. */
export function normalizePanelWidths(value: unknown): {sidebarWidth: number | null; agentWidth: number | null; consoleHeight: number | null} {
  const v = (value ?? {}) as {sidebarWidth?: unknown; agentWidth?: unknown; consoleHeight?: unknown};
  return {
    sidebarWidth: clampPanelWidth(v.sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX),
    agentWidth: clampPanelWidth(v.agentWidth, AGENT_MIN, AGENT_MAX),
    consoleHeight: clampPanelWidth(v.consoleHeight, CONSOLE_MIN, CONSOLE_MAX),
  };
}

/** Pure mapping from prefs to DOM state, so it can be tested without a browser. */
export function resolveInterface(prefs: InterfacePrefs): InterfacePresentation {
  return {
    dataset: {
      density: prefs.density,
      text: prefs.textSize,
      motion: prefs.reduceMotion ? 'reduce' : 'full',
      agent: prefs.agentSide,
    },
    style: {'--editor-font-size': `${prefs.editorFont}px`},
  };
}

/** Apply prefs to the live document. Safe to call when rendering on the server. */
export function applyInterfacePrefs(prefs: InterfacePrefs): void {
  if (typeof document === 'undefined') return;
  const resolved = resolveInterface(normalizeInterfacePrefs(prefs));
  const root = document.documentElement;
  root.dataset.uiDensity = resolved.dataset.density;
  root.dataset.uiText = resolved.dataset.text;
  root.dataset.uiMotion = resolved.dataset.motion;
  root.dataset.agentSide = resolved.dataset.agent;
  for (const [name, val] of Object.entries(resolved.style)) root.style.setProperty(name, val);
}
