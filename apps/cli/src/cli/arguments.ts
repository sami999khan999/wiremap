// Positionals, `--flag value`, `--flag=value`, repeatable flags and switches: small enough
// that a parsing library would be most of the bundle.
export interface ParsedArguments {
  readonly command: string | null;
  readonly positionals: readonly string[];
  readonly flags: ReadonlyMap<string, readonly string[]>;
  readonly switches: ReadonlySet<string>;
}

export class Arguments {
  private constructor() {}

  public static parse(argv: readonly string[], booleans: ReadonlySet<string>): ParsedArguments {
    const positionals: string[] = [];
    const flags = new Map<string, string[]>();
    const switches = new Set<string>();
    for (let index = 0; index < argv.length; index += 1) {
      const token = argv[index] as string;
      if (!token.startsWith("-")) {
        positionals.push(token);
        continue;
      }
      const [rawName, inline] = token.replace(/^-{1,2}/, "").split("=", 2) as [
        string,
        string | undefined,
      ];
      const name =
        rawName === "o" ? "out" : rawName === "h" ? "help" : rawName === "v" ? "version" : rawName;
      if (booleans.has(name)) {
        switches.add(name);
        continue;
      }
      const value = inline ?? argv[index + 1];
      if (inline === undefined) index += 1;
      if (value === undefined) throw new Error(`--${name} needs a value`);
      flags.set(name, [...(flags.get(name) ?? []), value]);
    }
    const [command = null, ...rest] = positionals;
    return { command, positionals: rest, flags, switches };
  }

  public static one(parsed: ParsedArguments, name: string): string | null {
    return parsed.flags.get(name)?.at(-1) ?? null;
  }
}
