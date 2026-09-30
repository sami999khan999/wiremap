import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { type AppearanceSnapshot, AppearanceStore } from "~/store/appearance.store.js";

// Sent only when the document opted in with `Accept-CH`, so treat its absence as light
// rather than as dark. The inline script in `__root.tsx` covers the case it misses.
const HINT = "sec-ch-prefers-color-scheme";

// The render path for appearance, and the reason the first painted byte is already the
// right colour: a cookie the server can read beats a preference only the client knows.
export const fetchAppearance = createServerFn({ method: "GET" }).handler((): AppearanceSnapshot => {
  const { headers } = getRequest();
  return AppearanceStore.fromCookieHeader(
    headers.get("cookie"),
    headers.get(HINT) === "dark",
    // The only place `Accept-Language` is read. A first visit with no cookie gets the
    // browser's language rather than English-and-a-switcher-to-find.
    headers.get("accept-language"),
  );
});
