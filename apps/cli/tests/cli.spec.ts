import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { GraphContract } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import { Arguments, Cli, Profile } from "../src/cli/index.js";

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
    expect(await Cli.run(["frobnicate"], capture().io)).toBe(2);
    expect(await Cli.run(["analyze", "/no/such/folder"], capture().io)).toBe(1);
  });
});

describe("login", () => {
  // A server that knows one key, and records which one each request carried.
  const server = (good: string) => {
    const seen: string[] = [];
    const http = (async (input: string | URL | Request, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      seen.push(`${String(input)} ${auth}`);
      if (auth !== `Bearer ${good}`) return new Response(null, { status: 401 });
      return Response.json({ items: [{ slug: "shop-api" }], total: 1 });
    }) as typeof fetch;
    return { http, seen };
  };

  const ioWith = async (
    http: typeof fetch,
    env: Partial<{ server: string; apiKey: string }> = {},
  ) => {
    const configHome = await mkdtemp(join(tmpdir(), "wiremap-config-"));
    const { io, out, err } = capture();
    return {
      configHome,
      out,
      err,
      io: {
        ...io,
        fetch: http,
        env: { server: env.server ?? null, apiKey: env.apiKey ?? null, configHome, inherited: {} },
        readLine: () => Promise.resolve("typed-key"),
      },
    };
  };

  it("checks the key, saves it readable by the user alone, and uses it after", async () => {
    const { http, seen } = server("typed-key");
    const { io, configHome, out } = await ioWith(http);

    expect(await Cli.run(["login", "--server", "https://wm.test/"], io)).toBe(0);
    const file = Profile.file(configHome);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await Profile.read(configHome)).toEqual({
      server: "https://wm.test/",
      apiKey: "typed-key",
    });

    expect(await Cli.run(["whoami"], io)).toBe(0);
    expect(out.join("")).toContain("1 projects: shop-api");
    expect(seen.at(-1)).toBe("https://wm.test/api/v1/projects?limit=100 Bearer typed-key");
  });

  it("saves nothing when the server refuses the key", async () => {
    const { http } = server("other-key");
    const { io, configHome, err } = await ioWith(http);

    expect(await Cli.run(["login", "--server", "https://wm.test"], io)).toBe(1);
    expect(err.join("")).toContain("refused the API key");
    expect(await Profile.read(configHome)).toBeNull();
  });

  it("prefers a flag to the environment, and the environment to the saved login", async () => {
    const { io, configHome } = await ioWith(server("x").http, { apiKey: "from-env" });
    await Profile.save(configHome, { server: "https://saved.test", apiKey: "saved-key" });

    const fromEnv = await Cli.credentials(Arguments.parse(["whoami"], new Set()), io);
    expect(fromEnv).toEqual({ server: "https://saved.test", apiKey: "from-env" });
    const fromFlag = await Cli.credentials(
      Arguments.parse(["whoami", "--api-key", "from-flag"], new Set()),
      io,
    );
    expect(fromFlag.apiKey).toBe("from-flag");
  });

  it("forgets the saved login", async () => {
    const { io, configHome, err } = await ioWith(server("x").http);
    await Profile.save(configHome, { server: "https://saved.test", apiKey: "saved-key" });

    expect(await Cli.run(["logout"], io)).toBe(0);
    expect(err.join("")).toContain("Signed out.");
    expect(await Profile.read(configHome)).toBeNull();
    await expect(Cli.credentials(Arguments.parse(["whoami"], new Set()), io)).rejects.toThrow(
      "Not signed in",
    );
  });
});
