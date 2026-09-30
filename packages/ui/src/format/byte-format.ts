const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

// Binary steps with decimal names, as every storage console shows. Fixed units and no
// locale separators, for the reason `DateFormat` gives: the server renders this.
export class ByteFormat {
  private constructor() {}

  // One decimal place above a kilobyte, none below it: "1.5 MB" is a size a person
  // reads, and "1536.0 B" is a number they have to convert.
  public static size(value: number): string {
    const bytes = Math.max(0, Math.round(value));
    if (bytes < 1024) return `${bytes} B`;

    let scaled = bytes;
    let unit = 0;
    while (scaled >= 1024 && unit < UNITS.length - 1) {
      scaled /= 1024;
      unit += 1;
    }

    return `${scaled.toFixed(1)} ${UNITS[unit]}`;
  }
}
