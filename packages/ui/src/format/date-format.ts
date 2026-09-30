// ISO, never locale-formatted: the server renders a date and the browser hydrates it, and
// `toLocaleDateString` disagrees between the two on every page that shows one.
export class DateFormat {
  private constructor() {}

  // `YYYY-MM-DD` in UTC. A display format, not a parse format: nothing reads it back.
  public static day(value: Date): string {
    return value.toISOString().slice(0, 10);
  }
}
