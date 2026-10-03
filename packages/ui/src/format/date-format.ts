// ISO, never locale-formatted: the server renders a date and the browser hydrates it, and
// `toLocaleDateString` disagrees between the two on every page that shows one.
export class DateFormat {
  private constructor() {}

  // `YYYY-MM-DD` in UTC. A display format, not a parse format: nothing reads it back.
  public static day(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  // `YYYY-MM-DD HH:MM` in UTC, for a trail where the order within a day matters.
  public static dateTime(value: Date): string {
    return `${value.toISOString().slice(0, 10)} ${value.toISOString().slice(11, 16)}`;
  }
}
