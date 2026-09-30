import { useRouter } from "@tanstack/react-router";
import { type Locale, Locales, useMessages } from "~/import.js";
import type { AppearanceStore } from "~/store/appearance.store.js";

export interface LocaleSwitcherProps {
  readonly appearance: AppearanceStore;
  readonly current: Locale;
}

// The leading hyphen keeps this out of the route tree, as `-guard.ts` and `-boundary.tsx`
// do. It lives here rather than in `feature` because only this app owns the cookie.
export function LocaleSwitcher({ appearance, current }: LocaleSwitcherProps) {
  const { t } = useMessages("common");
  const router = useRouter();

  const choose = (locale: Locale): void => {
    if (locale === current) return;

    const snapshot = appearance.current;
    const prefersDark =
      typeof matchMedia === "function" && matchMedia("(prefers-color-scheme:dark)").matches;
    appearance.choose(snapshot.theme, snapshot.preference, prefersDark, snapshot.font, locale);

    // Unlike theme and font, a locale is not a CSS variable: the copy has to be fetched.
    // `invalidate` re-runs the root, whose `beforeLoad` calls `MessageStore.setLocale`.
    void router.invalidate();
  };

  return (
    <label>
      {t("locale.label")}
      {
        // A native select styled as an input: the design system has no select yet.
      }
      <select
        className="ui-input"
        value={current}
        onChange={(event) => choose(event.target.value as Locale)}
      >
        {Locales.ALL.map((locale) => (
          <option key={locale} value={locale}>
            {
              // The endonym, never a translated name: it is what a reader who cannot
              // read the current locale is scanning for.
              Locales.label(locale)
            }
          </option>
        ))}
      </select>
    </label>
  );
}
