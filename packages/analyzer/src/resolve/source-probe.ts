// Turns a path without an extension, or with an emitted one, into a file that exists.
export class SourceProbe {
  private static readonly EXTENSIONS = [
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
  ];

  public constructor(private readonly files: ReadonlySet<string>) {}

  public find(base: string): string | null {
    const clean = base.replace(/\/+$/, "").replace(/^\.\//, "");
    if (this.files.has(clean)) return clean;
    // `./x.js` written for NodeNext names `./x.ts` on disk.
    const stem = clean.replace(/\.(m|c)?jsx?$/, "");
    for (const extension of SourceProbe.EXTENSIONS) {
      if (this.files.has(`${stem}${extension}`)) return `${stem}${extension}`;
    }
    for (const extension of SourceProbe.EXTENSIONS) {
      if (this.files.has(`${clean}/index${extension}`)) return `${clean}/index${extension}`;
    }
    return null;
  }
}
