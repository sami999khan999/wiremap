// A trace id arrives on the wire — in a request header, or in an error envelope being
// rebuilt — and then rides every log line for the life of what it identifies.
export class TraceIds {
  private constructor() {}

  // Long enough for a W3C traceparent and any upstream's request id, short enough that a
  // log line cannot be pushed out of shape by one.
  public static readonly MAX_LENGTH = 128;

  // Word characters, dot, colon and hyphen. Everything a real correlation id uses, and
  // nothing that could close a quote or start a line in a log the id is written into.
  private static readonly SHAPE = /^[\w.:-]+$/;

  public static sanitise(value: string | null | undefined): string | null {
    if (!value) return null;

    const trimmed = value.trim().slice(0, TraceIds.MAX_LENGTH);
    return trimmed.length > 0 && TraceIds.SHAPE.test(trimmed) ? trimmed : null;
  }
}
