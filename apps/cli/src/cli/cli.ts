import type { CliEnv } from "../env.js";
import {
  Analyzer,
  existsSync,
  fileURLToPath,
  type GraphDocument,
  gzipSync,
  mkdtemp,
  nodePath,
  readFile,
  rm,
  tmpdir,
  writeFile,
} from "../import.js";
import { Arguments, type ParsedArguments } from "./arguments.js";
import { Git } from "./git.js";
import { Profile } from "./profile.js";
import { PublicClient } from "./public-client.js";
import { type Checkout, ScanClient } from "./scan-client.js";

export interface CliIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly cwd: string;
  readonly fetch?: typeof fetch;
  readonly env?: CliEnv;
  // One line from stdin, for a key typed rather than left in the shell's history.
  readonly readLine?: () => Promise<string | null>;
}

interface Credentials {
  readonly server: string;
  readonly apiKey: string;
}

const VERSION = "0.1.0";
const BOOLEANS = new Set(["help", "version", "artisan", "pretty", "mask"]);

const HELP = `wiremap ${VERSION}

Usage:
  wiremap analyze [dir] [options]   Read a repository and write its graph
  wiremap upload <graph> [options]  Send a graph you built to a project
  wiremap scan [dir] [options]      analyze, then upload
  wiremap login --server <url>      Save a server and an API key for the commands below
  wiremap logout                    Forget them
  wiremap whoami                    Which server, and what the key can read
  wiremap runner [options]          What a scan workflow runs (see docs/infra/scan-runner.md)

Options:
  -o, --out <file>        Write the graph here (.json, or .json.gz to compress). Default: stdout
  --name <owner/repo>     The repository's name in the graph. Default: the folder's name
  --ignore <glob>         Skip matching paths, as in .gitignore. Repeatable
  --tsconfig <path>       Resolve every file with this tsconfig, relative to dir
  --artisan               Read Laravel routes from 'php artisan route:list' (needs PHP and vendor/)
  --pretty                Indent the JSON
  --server <url>          The wiremap server. Default: WIREMAP_SERVER, then the saved login
  --api-key <key>         An API key. Default: WIREMAP_API_KEY, then the saved login
  --project <slug>        The project's URL name (upload, scan)
  --branch <name>         The branch the graph was built from (upload, scan)
  --commit <sha>          The commit the graph was built from (upload, scan)
  -h, --help              This text
  -v, --version           The version

Nothing leaves your machine: analyze reads the code and writes a file. Only upload and
scan send anything, and what they send is the graph, never the source.
`;

// The command line. `run` returns the exit code rather than exiting, so a spec drives it.
export class Cli {
  private constructor() {}

  public static async run(argv: readonly string[], io: CliIo): Promise<number> {
    let parsed: ParsedArguments;
    try {
      parsed = Arguments.parse(argv, BOOLEANS);
    } catch (error) {
      io.err(`${(error as Error).message}\n`);
      return 2;
    }
    if (parsed.switches.has("version")) {
      io.out(`${VERSION}\n`);
      return 0;
    }
    if (parsed.switches.has("help") || parsed.command === null || parsed.command === "help") {
      io.out(HELP);
      return parsed.command === null && !parsed.switches.has("help") ? 2 : 0;
    }
    try {
      switch (parsed.command) {
        case "analyze":
          return await Cli.analyze(parsed, io);
        case "upload":
          return await Cli.upload(parsed, io);
        case "scan":
          return await Cli.scan(parsed, io);
        case "runner":
          return await Cli.runner(parsed, io);
        case "login":
          return await Cli.login(parsed, io);
        case "logout":
          return await Cli.logout(io);
        case "whoami":
          return await Cli.whoami(parsed, io);
        default:
          io.err(`Unknown command: ${parsed.command}\n\n${HELP}`);
          return 2;
      }
    } catch (error) {
      io.err(`${(error as Error).message}\n`);
      return 1;
    }
  }

  // The scan workflow's one step. Only counts are printed: the target repository's paths
  // never reach a run log, which may be public.
  private static async runner(parsed: ParsedArguments, io: CliIo): Promise<number> {
    const [server, ref, token] = Cli.required(parsed, ["server", "scan", "token"]);
    const client = new ScanClient(server, io.fetch);
    const workdir = await mkdtemp(nodePath.join(tmpdir(), "wiremap-scan-"));
    try {
      const checkout = await client.step<Checkout>(ref, token, "checkout");
      if (parsed.switches.has("mask"))
        for (const each of checkout.repositories) io.out(`::add-mask::${each.token}\n`);
      const repositories = [];
      for (const each of checkout.repositories) {
        const root = nodePath.join(workdir, each.name);
        const commit = await Git.clone(each.fullName, each.ref, each.token, root);
        repositories.push({ name: each.fullName, root, commit, branch: each.ref });
      }
      if (repositories.length === 0) throw new Error("The project has no repositories to scan.");
      const doc = await Analyzer.run({
        repositories,
        ignore: checkout.ignore,
        tsconfigPath: checkout.tsconfigPath,
        version: VERSION,
        ...Cli.grammar(),
      });
      const { url } = await client.step<{ url: string }>(ref, token, "upload");
      await client.put(url, gzipSync(JSON.stringify(doc)));
      const { state } = await client.step<{ state: string }>(ref, token, "complete");
      io.err(`${Cli.summary(doc)}\nScan ${state}.\n`);
      return state === "succeeded" ? 0 : 1;
    } catch (error) {
      const message = (error as Error).message;
      await client.step(ref, token, "fail", { error: message }).catch(() => undefined);
      throw error;
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }

  private static async upload(parsed: ParsedArguments, io: CliIo): Promise<number> {
    const file = parsed.positionals[0];
    if (!file)
      throw new Error("upload needs a graph file: wiremap upload graph.json --project <slug>");
    const raw = await readFile(nodePath.resolve(io.cwd, file));
    const bytes = file.endsWith(".gz") ? raw : gzipSync(raw);
    return Cli.send(parsed, io, bytes);
  }

  private static async scan(parsed: ParsedArguments, io: CliIo): Promise<number> {
    const root = nodePath.resolve(io.cwd, parsed.positionals[0] ?? ".");
    const doc = await Cli.build(parsed, root);
    io.err(`${Cli.summary(doc)}\n`);
    return Cli.send(parsed, io, gzipSync(JSON.stringify(doc)));
  }

  private static async send(
    parsed: ParsedArguments,
    io: CliIo,
    bytes: Uint8Array,
  ): Promise<number> {
    const [project] = Cli.required(parsed, ["project"]);
    const { server, apiKey } = await Cli.credentials(parsed, io);
    const client = new ScanClient(server, io.fetch);
    const upload = await client.createUpload(apiKey, {
      project,
      branch: Arguments.one(parsed, "branch"),
      commitSha: Arguments.one(parsed, "commit"),
    });
    await client.put(upload.uploadUrl, bytes);
    const { state } = await client.complete(upload.completeUrl, upload.token);
    io.err(`Uploaded to ${project}: scan ${state}.\n`);
    return state === "succeeded" ? 0 : 1;
  }

  // The key is checked against the server before it is saved, so a typo fails here and
  // not on the first upload.
  private static async login(parsed: ParsedArguments, io: CliIo): Promise<number> {
    const configHome = io.env?.configHome ?? null;
    if (!configHome) throw new Error("No config folder: set XDG_CONFIG_HOME or HOME.");
    const saved = await Profile.read(configHome);
    const server = Arguments.one(parsed, "server") ?? io.env?.server ?? saved?.server ?? null;
    if (!server) throw new Error("login needs --server <url>, the wiremap you sign in to.");
    let apiKey = Arguments.one(parsed, "api-key");
    if (!apiKey) {
      io.err("API key (create one under Settings, API keys): ");
      apiKey = (await io.readLine?.())?.trim() || null;
    }
    if (!apiKey) throw new Error("No API key given.");
    const page = await new PublicClient(server, apiKey, io.fetch).get<{ total: number }>(
      "/projects",
      { limit: "1" },
    );
    const file = await Profile.save(configHome, { server, apiKey });
    io.err(`Signed in to ${server}. The key reads ${page.total} projects.\nSaved to ${file}\n`);
    return 0;
  }

  private static async logout(io: CliIo): Promise<number> {
    const configHome = io.env?.configHome ?? null;
    const cleared = configHome ? await Profile.clear(configHome) : false;
    io.err(cleared ? "Signed out.\n" : "Not signed in.\n");
    return 0;
  }

  private static async whoami(parsed: ParsedArguments, io: CliIo): Promise<number> {
    const { server, apiKey } = await Cli.credentials(parsed, io);
    const page = await new PublicClient(server, apiKey, io.fetch).get<{
      items: readonly { slug: string }[];
      total: number;
    }>("/projects", { limit: "100" });
    io.out(`${server}\n${page.total} projects: ${page.items.map((p) => p.slug).join(", ")}\n`);
    return 0;
  }

  // A flag, then the environment, then the saved login: the order a CI job expects.
  public static async credentials(parsed: ParsedArguments, io: CliIo): Promise<Credentials> {
    const saved = await Profile.read(io.env?.configHome ?? null);
    const server = Arguments.one(parsed, "server") ?? io.env?.server ?? saved?.server ?? null;
    const apiKey = Arguments.one(parsed, "api-key") ?? io.env?.apiKey ?? saved?.apiKey ?? null;
    if (!server || !apiKey)
      throw new Error(
        "Not signed in: run `wiremap login --server <url>`, or pass --server and --api-key.",
      );
    return { server, apiKey };
  }

  // One value per name, in order, typed as a tuple of the same length.
  private static required<const N extends readonly string[]>(
    parsed: ParsedArguments,
    names: N,
  ): { [K in keyof N]: string } {
    return names.map((name) => {
      const value = Arguments.one(parsed, name);
      if (!value) throw new Error(`--${name} is required`);
      return value;
    }) as { [K in keyof N]: string };
  }

  private static build(parsed: ParsedArguments, root: string): Promise<GraphDocument> {
    return Analyzer.run({
      repositories: [{ name: Arguments.one(parsed, "name") ?? nodePath.basename(root), root }],
      ignore: parsed.flags.get("ignore") ?? [],
      tsconfigPath: Arguments.one(parsed, "tsconfig"),
      artisan: parsed.switches.has("artisan"),
      version: VERSION,
      ...Cli.grammar(),
    });
  }

  private static async analyze(parsed: ParsedArguments, io: CliIo): Promise<number> {
    const root = nodePath.resolve(io.cwd, parsed.positionals[0] ?? ".");
    if (!existsSync(root)) {
      io.err(`No such folder: ${root}\n`);
      return 1;
    }
    const doc = await Cli.build(parsed, root);
    const json = JSON.stringify(doc, null, parsed.switches.has("pretty") ? 2 : undefined);
    const out = Arguments.one(parsed, "out");
    if (out) {
      const target = nodePath.resolve(io.cwd, out);
      await writeFile(target, out.endsWith(".gz") ? gzipSync(json) : json);
      io.err(`${Cli.summary(doc)}\nWrote ${target}\n`);
    } else {
      io.out(`${json}\n`);
      io.err(`${Cli.summary(doc)}\n`);
    }
    return 0;
  }

  // The bundle ships `tree-sitter-php.wasm` beside itself; run from source, the analyzer
  // finds the grammar in its own dependencies.
  private static grammar(): { phpGrammar?: string } {
    const beside = fileURLToPath(new URL("./tree-sitter-php.wasm", import.meta.url));
    return existsSync(beside) ? { phpGrammar: beside } : {};
  }

  public static summary(doc: GraphDocument): string {
    const internal = doc.edges.filter((edge) => edge.kind === "import").length;
    const { resolved, total } = doc.coverage;
    const percent = total === 0 ? 100 : Math.round((resolved / total) * 100);
    const frameworks =
      doc.frameworks.map((framework) => framework.id).join(", ") || "none detected";
    return [
      `${doc.files.length} files · ${internal} imports between files here · ${doc.routes.length} routes`,
      `frameworks: ${frameworks}`,
      total > resolved
        ? `Graph is partial: ${resolved} of ${total} imports into this repository resolved (${percent}%)`
        : `All ${total} imports into this repository resolved`,
      `${doc.insights.cycles.length} cycles · ${doc.insights.unusedFiles.length} unused files · ${doc.insights.unguardedRoutes.length} unguarded routes`,
    ].join("\n");
  }
}
