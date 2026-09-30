import { oc } from "../import.js";
import { AnalyticsContract } from "./analytics.contract.js";

export class AnalyticsProcedures {
  private constructor() {}

  public static readonly activity = oc
    .route({ method: "GET", path: "/analytics/activity" })
    .input(AnalyticsContract.activityQuery)
    .output(AnalyticsContract.activity);

  public static readonly all = {
    activity: AnalyticsProcedures.activity,
  } as const;
}
