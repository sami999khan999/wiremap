import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defaultClientConditions, defaultServerConditions, defineConfig } from "vite";

// A function config, because one line of it has to differ between `vite dev` and
// `vite build` and there is no condition token that expresses it.
export default defineConfig(({ command }) => {
  // The `development` export condition resolves workspace packages to their `src/`
  // instead of `dist/`, so editing a package hot-reloads the browser with no rebuild.
  //
  // **Dev only, and prepended rather than assigned.** Two separate traps:
  //
  // 1. Vite's own default lists end with `development|production` — a token Vite expands
  //    to `production` in a build. A literal `"development"` in the array has no such
  //    behaviour, so leaving it in `vite build` picks the *development* entry of any
  //    dependency that publishes one. `@tanstack/react-router` does, and that is how its
  //    dev build came to ship in the production client bundle.
  // 2. Assigning the array replaces the defaults instead of extending them, dropping
  //    `browser` on the client and `node` on the server.
  //
  // If resolution ever misbehaves, drop `devCondition` entirely: you fall back to
  // consuming `dist/`, which still works with a rebuild between edit and reload.
  const devCondition = command === "serve" ? ["development"] : [];

  // The one port `.env` names, and the three URLs that must agree with it are
  // `APP_BASE_URL`, `AUTH_URL` and the first `AUTH_TRUSTED_ORIGINS` entry — `check:
  // architecture` §27 holds them together. Read here because a config file is the only
  // thing outside `env.ts` that may touch `process.env`.
  //
  // The fallback matters: `vite build` deliberately runs without `.env` loaded, since
  // that file sets `NODE_ENV=development` and the dev JSX transform would then ship into
  // the production bundle. `server` and `preview` are dev-only anyway.
  const port = Number(process.env.WEB_PORT ?? 43000);

  // Vercel sets `VERCEL` during its build, and Nitro then writes `.vercel/output` instead
  // of a Node server. Named here so the target is read in the config, not inferred.
  const preset = process.env.VERCEL ? "vercel" : undefined;

  return {
    server: { port },
    preview: { port },
    resolve: { tsconfigPaths: true, conditions: [...devCondition, ...defaultClientConditions] },
    ssr: {
      resolve: {
        conditions: [...devCondition, ...defaultServerConditions],
        externalConditions: [...devCondition, ...defaultServerConditions],
      },
      // Vite treats workspace packages as external Node modules otherwise, which
      // defeats the `src/` resolution above and the `"use client"` handling below it.
      noExternal: [/^@loadbearing\//],
    },
    plugins: [
      // Compiles src/style/app.css: the theme, the component CSS and every utility used.
      tailwindcss(),
      // The Start plugin owns route generation and must come before `viteReact()`. Two
      // things about this block are easy to get wrong and cost a confusing build failure:
      //
      // 1. It does **not** read `tsr.config.json` — pointing only that at a custom
      //    directory leaves the plugin looking in `src/routes/` and it dies with "Cannot
      //    convert undefined or null to object" while building the route manifest,
      //    naming neither the file nor the directory.
      // 2. These paths are relative to `srcDirectory` (`src`), not to the project root.
      //    Writing `src/route` here produces `ENOENT … apps/web/src/src/route`.
      tanstackStart({
        router: {
          routesDirectory: "route",
          generatedRouteTree: "route-tree.gen.ts",
        },
      }),
      // Deployment target only — it is what turns `vite build` into a `.output/` a Node
      // host can run. Deliberately unconfigured: the `/api/*` endpoints are Start server
      // routes under `src/route/api/`, so nothing here depends on Nitro's own file
      // scanning, and swapping this line for the Cloudflare or Netlify plugin changes the
      // host and nothing else.
      //
      // `traceDeps` keeps one React. Base UI reaches `useSyncExternalStore` through a CJS
      // shim whose `require("react")` the bundler cannot rewrite, so it loaded the copy in
      // `node_modules` while the renderer used the one bundled into `_libs/`. Every page
      // then failed to server-render and was drawn in the browser instead. Traced, both are
      // the same file, copied into `.output/server/node_modules`.
      nitro({ traceDeps: ["react", "react-dom"], ...(preset ? { preset } : {}) }),
      viteReact(),
    ],
  };
});
