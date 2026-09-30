// Which env file `docker compose` reads, which is the whole reason this wrapper exists.

// @ts-check

import { describe, expect, it } from "vitest";

import { composeArgs } from "../compose.mjs";

const at = (args, flag) => args.indexOf(flag);

describe("composeArgs", () => {
  it("names the compose file, so the cwd never decides which stack starts", () => {
    const args = composeArgs(["up", "-d"], false);

    expect(args[0]).toBe("compose");
    expect(at(args, "-f")).toBeGreaterThan(-1);
    expect(args.at(-2)).toBe("up");
    expect(args.at(-1)).toBe("-d");
  });

  // Compose's own default is the file beside the compose file — `infra/.env` — which is
  // how the stack came to read one env file while the apps read another.
  it("points compose at the root env file when there is one", () => {
    const args = composeArgs(["up"], true);

    expect(at(args, "--env-file")).toBeGreaterThan(-1);
    expect(args[at(args, "--env-file") + 1]).toMatch(/\.env$/);
  });

  // `--env-file` errors on a missing file and compose has no `-if-exists` form, so the
  // check is the thing that keeps CI — which has no `.env` at all — working.
  it("omits the flag entirely when there is no env file", () => {
    expect(composeArgs(["up"], false)).not.toContain("--env-file");
  });

  it("puts the flag before `-f`, where compose expects a global option", () => {
    const args = composeArgs(["up"], true);

    expect(at(args, "--env-file")).toBeLessThan(at(args, "-f"));
  });

  it("passes a profile through untouched", () => {
    expect(composeArgs(["--profile", "sharded", "up", "-d"], false)).toContain("sharded");
  });
});
