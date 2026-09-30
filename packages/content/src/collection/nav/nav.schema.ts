import { z } from "../../import.js";

// Shape 3: a repeating record an editor owns, parsed at module load — so a malformed
// entry is a startup error with a field path rather than a runtime one.
export class NavContract {
  private constructor() {}

  public static readonly item = z.object({
    // A `ModuleKey`, never the thing that gates it: a content edit able to change that
    // mapping would be a privilege escalation. Wide here, because a CMS row is.
    module: z.string(),
    labelKey: z.string(),
    icon: z.string(),
    order: z.number().int(),
  });

  public static readonly collection = z.array(NavContract.item);
}

export type NavItem = z.infer<typeof NavContract.item>;
