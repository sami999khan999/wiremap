import { useRouter } from "@tanstack/react-router";
import { type Locale, Locales, Select, useMessages } from "~/import.js";
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

  // One locale ships, so there is nothing to choose; a second one brings the control back.
  if (Locales.ALL.length < 2) return null;

  return (
    // The endonym, never a translated name: it is what a reader who cannot read the
    // current locale is scanning for.
    <Select
      label={t("locale.label")}
      value={current}
      onValueChange={(next) => choose(next as Locale)}
      options={Locales.ALL.map((locale) => ({ value: locale, label: Locales.label(locale) }))}
    />
  );
}
