// Light or dark, as an axis of its own. Splitting it off the theme key is what keeps
// adding a palette from doubling the key union.
export type ModeKey = "light" | "dark";

// What a user stores. `system` is a preference, never a mode — nothing renders it.
export type ModePreference = ModeKey | "system";

const MODES = {
  light: true,
  dark: true,
} as const;

export class ModeRegistry {
  private constructor() {}

  public static readonly DEFAULT: ModeKey = "light";

  public static all(): readonly ModeKey[] {
    return Object.keys(MODES) as ModeKey[];
  }

  // `Object.hasOwn`, not `in` — `in` walks the prototype chain, so `"toString"` would
  // pass this guard. This is the boundary an untrusted stored preference crosses.
  public static isKnown(value: string): value is ModeKey {
    return Object.hasOwn(MODES, value);
  }

  public static isPreference(value: string): value is ModePreference {
    return value === "system" || ModeRegistry.isKnown(value);
  }

  // Takes a boolean, never `matchMedia` — the same reason `Locales.negotiate` takes
  // strings. Reading the OS preference is the caller's job, on both sides of SSR.
  public static resolve(preference: ModePreference, prefersDark: boolean): ModeKey {
    if (preference === "system") return prefersDark ? "dark" : "light";
    return preference;
  }

  // `colorScheme` lives here rather than on the theme because it is a property of the
  // mode. It is what makes native scrollbars, date pickers and form chrome match.
  public static apply(root: HTMLElement, key: ModeKey): void {
    root.dataset.mode = key;
    root.style.colorScheme = key;
  }
}
