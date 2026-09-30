// The keys a payload names its subject by, in the order they are tried. A convention
// over the bag rather than a column, so a slice adds a key here and nowhere else.
const KEYS: readonly string[] = Object.freeze([
  "subjectId",
  "taskId",
  "goalId",
  "documentId",
  "userId",
]);

// Lifted out of `PgActivityReplayReader` when a second reader needed it: a re-projection
// that disagreed would write a different `subject_id` from the live projection's.
export class ActivitySubject {
  private constructor() {}

  // Null for a payload that names no subject, which is most of them — the column is
  // `Nullable(UUID)` in ClickHouse for that reason.
  public static of(payload: Readonly<Record<string, unknown>>): string | null {
    for (const key of KEYS) {
      const value = payload[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
    return null;
  }
}
