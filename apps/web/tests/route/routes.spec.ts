import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GATES, ROUTES } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";

const ROUTE_DIR = join(import.meta.dirname, "../../src/route");

// `createFileRoute("/(app)/_authenticated/settings/roles")` → `/settings/roles`. Route
// groups and pathless layouts organise files and contribute nothing to the URL.
function urlOf(id: string): string {
  const path = id
    .replace(/\/\([^)]*\)/g, "")
    .replace(/\/_[^/]+/g, "")
    .replace(/\/index$/, "/");

  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path || "/";
}

function routeIds(dir: string): readonly string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...routeIds(full));
      continue;
    }
    // A `-` prefix marks a file as *not* a route — the framework's own convention.
    if (!entry.endsWith(".tsx") || entry.startsWith("-")) continue;

    for (const match of readFileSync(full, "utf8").matchAll(/createFileRoute\("([^"]+)"\)/g)) {
      const id = match[1];
      if (id) out.push(id);
    }
  }

  return out;
}

const DECLARED = new Set<string>(Object.values(ROUTES).flatMap((group) => Object.values(group)));

// Not routes anyone navigates to: the API mounts live in the route tree because that is
// how Start binds a handler, and they are transport rather than destinations.
const API = /^\/api\//;
// Parameterised, so the literal in the file is a pattern and the table holds its stem.
const PARAM = /\$/;
// Design and QA surfaces. `(dev)` is a route group, and the page throws `notFound()`
// outside a development build — nothing links to it, so nothing declares it.
const DEV = new Set(["/kitchen-sink"]);

describe("every route file matches a declared destination", () => {
  it("declares every page route in ROUTES", () => {
    const undeclared = routeIds(ROUTE_DIR)
      .map(urlOf)
      .filter((url) => !API.test(url) && !DEV.has(url))
      .filter((url) => !DECLARED.has(PARAM.test(url) ? url.replace(/\/\$.*$/, "") : url));

    // A page whose path no fragment declares is one a `<Link>` cannot be typed against,
    // and a gate pointing at it would compile only by widening `AppRoute` to `string`.
    expect(undeclared).toEqual([]);
  });

  it("has a route file for every path a module gate points at", () => {
    const built = new Set(routeIds(ROUTE_DIR).map(urlOf));
    const missing = Object.values(GATES)
      .map((gate) => gate.route)
      .filter((route) => !built.has(route));

    // The failure this catches: a gate renders a nav link to a path with no page, so a
    // permission someone holds leads to a 404 rather than to the feature.
    expect(missing).toEqual([]);
  });
});
