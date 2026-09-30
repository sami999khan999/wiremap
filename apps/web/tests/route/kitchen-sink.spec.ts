import { describe, expect, it, vi } from "vitest";
import { Route } from "../../src/route/(dev)/kitchen-sink.js";

// TanStack types `loader` on the options object as a constrained generic rather than a
// plain function, so the shape is asserted here once and both cases call through this.
function loader(): void {
  const fn = Route.options.loader;
  if (typeof fn !== "function") throw new TypeError("the route declares no loader");
  (fn as () => void)();
}

// `(dev)` is a route group: it organises files and contributes nothing to the URL, so
// nothing about the directory name keeps this page out of a production build.
describe("/kitchen-sink is a development surface", () => {
  it("throws notFound when the build is not a development one", () => {
    vi.stubEnv("DEV", false);

    expect(loader).toThrow();

    vi.unstubAllEnvs();
  });

  it("renders in development, which is the only place it is useful", () => {
    vi.stubEnv("DEV", true);

    expect(loader).not.toThrow();

    vi.unstubAllEnvs();
  });
});
