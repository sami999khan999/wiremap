import { z } from "../import.js";

// An opaque base64url token, and the bound is a denial-of-service guard in the schema
// rather than in a handler — so the worker and the offline queue inherit it too.
const CURSOR_MAX = 256;

// Keyset, not offset, and the reason is the tables it pages: `OFFSET 40000` over a
// partitioned table reads forty thousand rows to discard them.
export class Keyset {
  private constructor() {}

  public static readonly query = z.object({
    limit: z.number().int().positive().max(100).default(50),
    // Absent means the first page. The client never builds one — it echoes back the
    // `nextCursor` it was given, which is what makes the encoding ours to change.
    cursor: z.string().max(CURSOR_MAX).optional(),
  });

  // **No `total`.** A count per page over a partitioned table is precisely the cost
  // keyset pagination exists to avoid, and no screen here needs one.
  public static page<T extends z.ZodType>(item: T) {
    return z.object({
      items: z.array(item).readonly(),
      // Null is the last page, and it is not the same as an empty page: a full page can
      // still be the last one, and a client that inferred otherwise would fetch again.
      nextCursor: z.string().nullable(),
    });
  }
}

export type KeysetQuery = z.infer<typeof Keyset.query>;
