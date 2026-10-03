import { eventIterator, oc, z } from "../import.js";
import { AskContract } from "./ask.contract.js";

export class AskProcedures {
  private constructor() {}

  public static readonly settings = oc
    .route({ method: "GET", path: "/ai/settings" })
    .input(z.object({}))
    .output(AskContract.settings);

  public static readonly updateSettings = oc
    .route({ method: "PUT", path: "/ai/settings" })
    .input(AskContract.updateSettings)
    .output(AskContract.settings);

  // One tiny request with the stored key, so "it does not work" is found here, not in Ask.
  public static readonly testKey = oc
    .route({ method: "POST", path: "/ai/settings/test" })
    .input(z.object({}))
    .output(AskContract.testResult);

  // Whether Ask is on for this organization: the explorer hides the tab when it is not.
  public static readonly available = oc
    .route({ method: "GET", path: "/ai/available" })
    .input(z.object({}))
    .output(z.object({ available: z.boolean() }));

  public static readonly question = oc
    .route({ method: "POST", path: "/projects/{projectId}/ask" })
    .input(AskContract.question)
    .output(eventIterator(AskContract.chunk));

  public static readonly all = {
    settings: AskProcedures.settings,
    updateSettings: AskProcedures.updateSettings,
    testKey: AskProcedures.testKey,
    available: AskProcedures.available,
    question: AskProcedures.question,
  } as const;
}
