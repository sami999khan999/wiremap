import {
  Analyzer,
  existsSync,
  fileURLToPath,
  type GraphDocument,
  gzipSync,
  nodePath,
  writeFile,
} from "../import.js";
import { Arguments, type ParsedArguments } from "./arguments.js";

export interface CliIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly cwd: string;
}

const VERSION = "0.1.0";
const BOOLEANS = new Set(["help", "version", "artisan", "pretty"]);

const HELP = `wiremap ${VERSION}

Usage:
  wiremap analyze [dir] [options]   Read a repository and write its graph

Options:
  -o, --out <file>        Write the graph here (.json, or .json.gz to compress). Default: stdout
  --name <owner/repo>     The repository's name in the graph. Default: the folder's name
  --ignore <glob>         Skip matching paths, as in .gitignore. Repeatable
  --tsconfig <path>       Resolve every file with this tsconfig, relative to dir
  --artisan               Read Laravel routes from 'php artisan route:list' (needs PHP and vendor/)
  --pretty                Indent the JSON
  -h, --help              This text
  -v, --version           The version

Nothing leaves your machine: analyze reads the code and writes a file.
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
    if (parsed.command !== "analyze") {
      io.err(`Unknown command: ${parsed.command}\n\n${HELP}`);
      return 2;
    }
    return Cli.analyze(parsed, io);
  }

  private static async analyze(parsed: ParsedArguments, io: CliIo): Promise<number> {
    const root = nodePath.resolve(io.cwd, parsed.positionals[0] ?? ".");
    if (!existsSync(root)) {
      io.err(`No such folder: ${root}\n`);
      return 1;
    }
    const doc = await Analyzer.run({
      repositories: [{ name: Arguments.one(parsed, "name") ?? nodePath.basename(root), root }],
      ignore: parsed.flags.get("ignore") ?? [],
      tsconfigPath: Arguments.one(parsed, "tsconfig"),
      artisan: parsed.switches.has("artisan"),
      version: VERSION,
      ...Cli.grammar(),
    });
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
