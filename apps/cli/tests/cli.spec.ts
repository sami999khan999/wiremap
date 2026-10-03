import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { GraphContract } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import { Arguments, Cli } from "../src/cli/index.js";

const fixture = fileURLToPath(
  new URL("../../../packages/analyzer/tests/fixture/nestjs", import.meta.url),
);

const capture = () => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out: (text: string) => out.push(text),
      err: (text: string) => err.push(text),
      cwd: process.cwd(),
    },
    out,
    err,
  };
};

describe("Arguments", () => {
  it("reads positionals, repeatable flags, inline values and switches", () => {
    const parsed = Arguments.parse(
      ["analyze", "src", "--ignore", "a", "--ignore=b", "-o", "g.json", "--pretty"],
      new Set(["pretty"]),
    );

    expect(parsed.command).toBe("analyze");
    expect(parsed.positionals).toEqual(["src"]);
    expect(parsed.flags.get("ignore")).toEqual(["a", "b"]);
    expect(Arguments.one(parsed, "out")).toBe("g.json");
    expect(parsed.switches.has("pretty")).toBe(true);
    expect(() => Arguments.parse(["analyze", "--out"], new Set())).toThrow("--out needs a value");
  });
});

describe("Cli", () => {
  it("writes a gzipped graph that parses, and says what it found", async () => {
    const { io, err } = capture();
    const out = join(await mkdtemp(join(tmpdir(), "wiremap-cli-")), "graph.json.gz");

    const code = await Cli.run(["analyze", fixture, "--name", "acme/api", "-o", out], io);

    expect(code).toBe(0);
    const doc = GraphContract.document.parse(
      JSON.parse(gunzipSync(await readFile(out)).toString("utf8")),
    );
    expect(doc.meta.repositories[0]?.name).toBe("acme/api");
    expect(doc.routes).toHaveLength(8);
    expect(err.join("")).toContain("8 routes");
    expect(err.join("")).toContain("All 18 imports into this repository resolved");
  });

  it("answers help, version and a bad command with the right exit codes", async () => {
    const help = capture();
    expect(await Cli.run(["--help"], help.io)).toBe(0);
    expect(help.out.join("")).toContain("wiremap analyze");
    expect(await Cli.run([], capture().io)).toBe(2);
    expect(await Cli.run(["scan"], capture().io)).toBe(2);
    expect(await Cli.run(["analyze", "/no/such/folder"], capture().io)).toBe(1);
  });
});
