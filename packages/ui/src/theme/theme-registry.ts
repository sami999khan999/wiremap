import { type ModeKey, ModeRegistry } from "./mode-registry.js";

export interface ThemeMeta {
  readonly label: string;
  // Which modes this palette actually ships a block for. A theme with one entry is a
  // theme whose CSS matches nothing in the other mode.
  readonly modes: readonly ModeKey[];
}

const THEMES = {
  slate: { label: "Slate", modes: ["light", "dark"] },
  ocean: { label: "Ocean", modes: ["light", "dark"] },
  forest: { label: "Forest", modes: ["light", "dark"] },
  plum: { label: "Plum", modes: ["light", "dark"] },
  midnight: { label: "Midnight", modes: ["dark"] },
  graphite: { label: "Graphite", modes: ["light", "dark"] },
} as const satisfies Record<string, ThemeMeta>;

export type ThemeKey = keyof typeof THEMES;

export class ThemeRegistry {
  private constructor() {}

  public static readonly DEFAULT: ThemeKey = "slate";

  public static all(): readonly ThemeKey[] {
    return Object.keys(THEMES) as ThemeKey[];
  }

  public static meta(key: ThemeKey): ThemeMeta {
    return THEMES[key];
  }

  // `Object.hasOwn`, not `in`: this is the boundary an untrusted stored preference
  // crosses, and `"toString"` would otherwise pass the guard.
  public static isKnown(value: string): value is ThemeKey {
    return Object.hasOwn(THEMES, value);
  }

  public static supports(key: ThemeKey, mode: ModeKey): boolean {
    // Widened first: each entry's `modes` is a literal tuple, so `includes` would
    // otherwise only accept the one mode that palette happens to declare.
    const modes: readonly ModeKey[] = THEMES[key].modes;
    return modes.includes(mode);
  }

  // A dark-only palette asked to render light matches no selector at all, which is a
  // page with no colours. This is the call that stops that pair reaching the DOM.
  public static resolveMode(key: ThemeKey, wanted: ModeKey): ModeKey {
    if (ThemeRegistry.supports(key, wanted)) return wanted;
    return THEMES[key].modes[0] ?? ModeRegistry.DEFAULT;
  }

  // Apply to <html>. Safe to call before hydration, and it moves one attribute — the
  // mode is ModeRegistry's to set, so a palette switch never disturbs it.
  public static apply(root: HTMLElement, key: ThemeKey): void {
    root.dataset.theme = key;
  }
}
