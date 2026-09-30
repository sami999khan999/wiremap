import { z } from "../import.js";

export class Pagination {
  private constructor() {}

  // `max(100)` is a denial-of-service guard in the schema rather than a handler,
  // so it applies to the worker and the offline queue too.
  public static readonly query = z.object({
    limit: z.number().int().positive().max(100).default(25),
    offset: z.number().int().nonnegative().default(0),
  });
}

export type PaginationQuery = z.infer<typeof Pagination.query>;
