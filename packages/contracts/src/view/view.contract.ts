import { z } from "../import.js";
import { Identifiers } from "../primitive/index.js";

// A saved explorer view: a name and the explorer's URL query, which is its whole state.
export class ViewContract {
  private constructor() {}

  public static readonly entity = z.object({
    id: Identifiers.graphViewId,
    projectId: Identifiers.projectId,
    name: z.string(),
    // The query string after `?`, as the explorer's URL carries it.
    state: z.string(),
    createdBy: Identifiers.userId,
    createdAt: z.date(),
  });

  public static readonly list = z.object({ projectId: Identifiers.projectId });

  public static readonly save = z.object({
    projectId: Identifiers.projectId,
    name: z.string().trim().min(1).max(80),
    state: z.string().max(2_000),
  });

  public static readonly remove = z.object({
    projectId: Identifiers.projectId,
    viewId: Identifiers.graphViewId,
  });
}

export type GraphViewDto = z.infer<typeof ViewContract.entity>;
export type SaveViewInput = z.infer<typeof ViewContract.save>;
export type RemoveViewInput = z.infer<typeof ViewContract.remove>;
