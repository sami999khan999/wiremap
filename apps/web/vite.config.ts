import { type IncomingMessage, request, type ServerResponse } from "node:http";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import {
  type Connect,
  defaultClientConditions,
  defaultServerConditions,
  defineConfig,
  type Plugin,
} from "vite";

// `/api/realtime` to the stream process, apps/realtime. Not `server.proxy`: Start's
// middleware answers every path before Vite's proxy runs, so the proxy never saw a request.
// Registered by the first plugin, it runs first. The response is piped, never buffered, so
// an event stream reaches the tab as it is written. Production does this in the proxy.
function realtimeProxy(target: string): Plugin {
  const forward = (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    if (!req.url?.startsWith("/api/realtime")) return next();

    const upstream = request(
      `${target}${req.url}`,
      { method: req.method, headers: req.headers },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    // A tab that closes its stream closes the upstream one, or the stream process keeps a
    // subscription open for a reader that has gone.
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  };

  return {
    name: "loadbearing:realtime-proxy",
    configureServer: (server) => {
      server.middlewares.use(forward);
    },
    configurePreviewServer: (server) => {
      server.middlewares.use(forward);
    },
  };
}

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

  // The stream process, behind this origin so the session cookie rides along. In production
  // the reverse proxy does the same split — see docs/infra/deployment.md.
  const realtime = `http://localhost:${process.env.REALTIME_PORT ?? 43001}`;

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
      // First, so its middleware runs before Start's.
      realtimeProxy(realtime),
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
      nitro({ traceDeps: ["react", "react-dom"] }),
      viteReact(),
    ],
  };
});
