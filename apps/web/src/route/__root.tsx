import { createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";
import {
  ApiClientProvider,
  ContentSource,
  type CSSProperties,
  classCss,
  FontRegistry,
  MessageProvider,
  QueryClientProvider,
  type ReactNode,
  SessionProvider,
  ThemeRegistry,
  themeCss,
} from "~/import.js";
import { fetchAppearance } from "~/server/appearance.fn.js";
import { fetchSession } from "~/server/session.fn.js";
import { ErrorBoundary, NotFound } from "./-boundary.js";
import type { RouterContext } from "./-context.js";

// The one case the cookie cannot answer: "system" with no client hint. Synchronous and
// in <head>, or the correction lands after first paint.
const SYSTEM_MODE_SCRIPT = `(()=>{try{if(matchMedia("(prefers-color-scheme:dark)").matches){const r=document.documentElement;r.dataset.mode="dark";r.style.colorScheme="dark";}}catch{}})()`;

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context }) => {
    await Promise.all([
      context.session.ensure(fetchSession),
      context.appearance.ensure(fetchAppearance),
    ]);

    // Before the loader below, which is what makes the ordering load-bearing: `ensure`
    // fetches a namespace for whatever locale the store holds when it is called.
    context.messages.setLocale(context.appearance.current.locale);

    return {
      user: context.session.user,
      capabilities: context.session.dto,
      isPlatformOrganization: context.session.isPlatformOrganization,
      googleEnabled: context.session.googleEnabled,
      flags: context.session.flags,
      appearanceSnapshot: context.appearance.current,
    };
  },
  loader: ({ context }) => context.messages.ensure(ContentSource.SHELL),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Loadbearing" },
    ],
    links: [
      // Tokens and colours first, the default look second: class.css reads the names
      // theme.css defines, and an app supplying its own design drops the second link.
      { rel: "stylesheet", href: themeCss },
      { rel: "stylesheet", href: classCss },
    ],
  }),
  shellComponent: RootDocument,
  // On the root, so every route inherits them: a boundary declared per page is one
  // somebody forgets, and an unhandled throw in TanStack Router renders a bare stack.
  errorComponent: ErrorBoundary,
  notFoundComponent: NotFound,
});

function RootDocument({ children }: { children: ReactNode }) {
  const {
    messages,
    queryClient,
    api,
    user,
    capabilities,
    isPlatformOrganization,
    flags,
    appearanceSnapshot,
  } = Route.useRouteContext();
  const { theme, mode, preference, font } = appearanceSnapshot;

  // Only when the server guessed, and only upgrading light to dark — so it cannot fight
  // an explicit choice or strand a dark-only theme.
  const correctsMode = preference === "system" && ThemeRegistry.supports(theme, "dark");

  // The font override on the server-rendered element rather than after hydration: a
  // face that swaps in front of the reader reflows the whole page.
  const style = {
    colorScheme: mode,
    "--font-sans": FontRegistry.meta(font).stack,
  } as CSSProperties;

  return (
    // `suppressHydrationWarning` because the script below edits these two attributes
    // before React hydrates. It covers this element only, never its children.
    <html
      lang={messages.translator.locale}
      data-theme={theme}
      data-mode={mode}
      style={style}
      suppressHydrationWarning
    >
      <head>
        <HeadContent />
        {correctsMode ? <script dangerouslySetInnerHTML={{ __html: SYSTEM_MODE_SCRIPT }} /> : null}
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider client={api}>
            <MessageProvider messages={messages}>
              <SessionProvider
                user={user}
                capabilities={capabilities}
                isPlatformOrganization={isPlatformOrganization}
                flags={flags}
              >
                {children}
              </SessionProvider>
            </MessageProvider>
          </ApiClientProvider>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
