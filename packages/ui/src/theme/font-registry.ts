export interface FontMeta {
  readonly label: string;
  // The full stack, written out rather than assembled: splitting it into a family plus a
  // fallback list invites a component to reassemble it differently.
  readonly stack: string;
}

// Reading font choice as a *token override* rather than a theme is what keeps the two
// independent: a reader can pick a serif face without also picking a colour scheme.
const FONTS = {
  sans: { label: "Inter", stack: '"Inter", system-ui, sans-serif' },
  serif: { label: "Serif", stack: "ui-serif, Georgia, Cambria, serif" },
  mono: { label: "Monospace", stack: '"JetBrains Mono", ui-monospace, monospace' },
} as const satisfies Record<string, FontMeta>;

export type FontKey = keyof typeof FONTS;

export class FontRegistry {
  private constructor() {}

  public static readonly DEFAULT: FontKey = "sans";

  public static all(): readonly FontKey[] {
    return Object.keys(FONTS) as FontKey[];
  }

  public static meta(key: FontKey): FontMeta {
    return FONTS[key];
  }

  public static isKnown(value: string): value is FontKey {
    return Object.hasOwn(FONTS, value);
  }

  // Overrides `--font-sans` on the root rather than restyling anything, so one line
  // changes the whole system and nothing re-renders.
  public static apply(root: HTMLElement, key: FontKey): void {
    root.style.setProperty("--font-sans", FONTS[key].stack);
  }
}
