// Gitignore-shaped patterns, enough for ignore lists: `name` matches a segment anywhere,
// `dir/` only a folder, `/x` is anchored to the root, `*` stays in a segment, `**` crosses them.
export class Glob {
  private readonly regex: RegExp;
  private readonly directoryOnly: boolean;

  public constructor(pattern: string) {
    let body = pattern.trim();
    this.directoryOnly = body.endsWith("/");
    if (this.directoryOnly) body = body.slice(0, -1);
    const anchored = body.startsWith("/") || body.includes("/");
    body = body.replace(/^\//, "").replace(/^\*\*\//, "");
    const source = body
      .replaceAll("**/", "\u0001")
      .replaceAll("**", "\u0002")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", "[^/]*")
      .replaceAll("?", "[^/]")
      .replaceAll("\u0001", "(?:.*/)?")
      .replaceAll("\u0002", ".*");
    const leading = pattern.trim().startsWith("**/") || !anchored ? "(?:^|.*/)" : "^";
    this.regex = new RegExp(`${leading}${source}(?:/.*)?$`);
  }

  // A folder pattern only ever prunes a folder; the walker never descends into one it matched.
  public matches(path: string, directory: boolean): boolean {
    if (this.directoryOnly && !directory) return false;
    return this.regex.test(path);
  }

  public static any(globs: readonly Glob[], path: string, directory: boolean): boolean {
    return globs.some((glob) => glob.matches(path, directory));
  }

  // A `.gitignore`'s lines, minus comments, blanks and negations, which are not supported:
  // ignoring a little less than asked is safer than scanning what was excluded.
  public static fromGitignore(text: string): Glob[] {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#") && !line.startsWith("!"))
      .map((line) => new Glob(line));
  }
}
