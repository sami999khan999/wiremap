import { z } from "../import.js";
import { Identifiers } from "../primitive/index.js";

export class OverrideContract {
  private constructor() {}

  // One live exception. Raw strings, like a role's grants: a renamed key must not make
  // this endpoint throw.
  public static readonly entity = z.object({
    id: z.string(),
    userId: Identifiers.userId,
    permission: z.string(),
    effect: z.enum(["grant", "deny"]),
    // `platform` is the tier's deny: shown, locked, and not the org's to clear.
    authority: z.enum(["org", "platform"]),
    reason: z.string().nullable(),
    expiresAt: z.date().nullable(),
    createdAt: z.date(),
  });

  public static readonly list = z.object({ items: z.array(OverrideContract.entity).readonly() });

  public static readonly listQuery = z.object({ userId: Identifiers.userId });

  // `coerce`, because a date arrives as a string over the OpenAPI adapter. Null is the
  // default thirty days; the use-case refuses anything past ninety.
  public static readonly grant = z.object({
    userId: Identifiers.userId,
    permission: z.string().trim().min(1).max(128),
    reason: z.string().trim().min(1).max(500),
    expiresAt: z.coerce.date().nullable(),
  });

  public static readonly deny = z.object({
    userId: Identifiers.userId,
    permission: z.string().trim().min(1).max(128),
    reason: z.string().trim().max(500).nullable(),
  });

  public static readonly clear = z.object({ overrideId: z.string().min(1).max(64) });

  // Every key the closure reached, so the screen can say what came along.
  public static readonly written = z.object({ permissions: z.array(z.string()).readonly() });
}

export type OverrideEntityDto = z.infer<typeof OverrideContract.entity>;
export type OverrideListDto = z.infer<typeof OverrideContract.list>;
export type GrantOverrideInput = z.infer<typeof OverrideContract.grant>;
export type DenyOverrideInput = z.infer<typeof OverrideContract.deny>;
export type ClearOverrideInput = z.infer<typeof OverrideContract.clear>;
export type OverrideWrittenDto = z.infer<typeof OverrideContract.written>;
