import { z } from "../import.js";

// ISO `YYYY-MM-DD`, never a `Date` — `23.14`'s fourth decision. `date_trunc` and `toDate`
// answer in different shapes, and each adapter normalises to this one.
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export class AnalyticsContract {
  private constructor() {}

  // Two windows, not a free number: a span the screen offers is the one the store is
  // asked for, and an unbounded one is a scan of the tenant's whole history.
  public static readonly period = z.union([z.literal(30), z.literal(90)]);

  public static readonly activityQuery = z.object({
    days: AnalyticsContract.period.default(30),
  });

  public static readonly activityPoint = z.object({
    day: DAY,
    action: z.string().min(1),
    count: z.number().int().nonnegative(),
  });

  // `configured: false` is a deployment with no analytics store, the third state the
  // screen renders — neither empty nor failing. `[from, to)`, both days in UTC.
  public static readonly activity = z.object({
    configured: z.boolean(),
    from: DAY,
    to: DAY,
    points: z.array(AnalyticsContract.activityPoint).readonly(),
  });
}

export type ActivityQuery = z.infer<typeof AnalyticsContract.activityQuery>;
export type ActivityPointDto = z.infer<typeof AnalyticsContract.activityPoint>;
export type ActivityDto = z.infer<typeof AnalyticsContract.activity>;
