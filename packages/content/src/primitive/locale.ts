export type Locale = "en" | "bn";

// Frozen at module load rather than a `static readonly`, which freezes the binding
// and not the object.
const LABELS: Readonly<Record<Locale, string>> = Object.freeze({ en: "English", bn: "বাংলা" });

export class Locales {
  private constructor() {}

  public static readonly ALL: readonly Locale[] = ["en", "bn"];
  public static readonly DEFAULT: Locale = "en";

  // Endonyms, so a switcher reads the same in every locale — the one label that must
  // never be translated, because it is what a lost reader looks for.
  public static label(locale: Locale): string {
    return LABELS[locale];
  }

  // The boundary that narrows an untrusted string before it can index a catalog.
  public static is(value: string | null | undefined): value is Locale {
    return value !== null && value !== undefined && Locales.ALL.includes(value as Locale);
  }

  // `override` wins — a cookie or a settings screen — else the first matching tag.
  // Takes strings, never a `Request`, so this package stays DOM-free.
  public static negotiate(acceptLanguage: string | null, override: string | null): Locale {
    if (Locales.is(override)) return override;

    for (const part of (acceptLanguage ?? "").split(",")) {
      const tag = part.split(";")[0]?.trim().split("-")[0] ?? "";
      if (Locales.is(tag)) return tag;
    }

    return Locales.DEFAULT;
  }
}
