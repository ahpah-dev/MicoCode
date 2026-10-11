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

/** Clamp a saved width into range, or null when it was never set. */
export function clampPanelWidth(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Saved panel widths survive only when they are usable numbers. */
export function normalizePanelWidths(value: unknown): {sidebarWidth: number | null; agentWidth: number | null} {
  const v = (value ?? {}) as {sidebarWidth?: unknown; agentWidth?: unknown};
  return {
    sidebarWidth: clampPanelWidth(v.sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX),
    agentWidth: clampPanelWidth(v.agentWidth, AGENT_MIN, AGENT_MAX),
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
