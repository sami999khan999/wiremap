import { z } from "../import.js";

// Decided once here, so every list procedure inherits it — the alternative is a
// different empty state per feature in the UI.
export class Envelope {
  private constructor() {}

  public static paginated<T extends z.ZodType>(item: T) {
    return z.object({
      // `.readonly()`, so the inferred type matches what every use-case returns.
      // Without it each handler copies the array to widen it, once per procedure.
      items: z.array(item).readonly(),
      total: z.number().int().nonnegative(),
      limit: z.number().int().positive(),
      offset: z.number().int().nonnegative(),
    });
  }

  public static readonly acknowledged = z.object({
    ok: z.literal(true),
  });
}
