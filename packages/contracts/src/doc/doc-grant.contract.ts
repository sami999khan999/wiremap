import { z } from "../import.js";
import { Identifiers } from "../primitive/index.js";

// Who a `granted` platform space is opened to: one organization, one person, or every
// organization on a plan. The plan is how a private space rides an entitlement.
const kind = z.enum(["organization", "user", "plan"]);

const grant = z.object({
  id: z.uuid(),
  spaceId: Identifiers.docSpaceId,
  kind,
  // What the grant names, as an operator reads it: the organization's name, the person's
  // email, the plan's name. Resolved on the catalog, beside the row.
  label: z.string(),
  reason: z.string(),
  expiresAt: z.date().nullable(),
  createdAt: z.date(),
});

export class DocGrantContract {
  private constructor() {}

  public static readonly kind = kind;
  public static readonly entity = grant;

  public static readonly listQuery = z.object({ spaceId: Identifiers.docSpaceId });

  public static readonly list = z.object({ items: z.array(grant).readonly() });

  // `target` is whatever the operator is holding for that kind: an organization's id or
  // slug, a person's email, a plan's key. The server resolves it and says if nothing answers.
  public static readonly save = z.object({
    spaceId: Identifiers.docSpaceId,
    kind,
    target: z.string().trim().min(1).max(320),
    reason: z.string().trim().min(1).max(500),
    expiresAt: z.date().nullable().default(null),
  });

  public static readonly revoke = z.object({ grantId: z.uuid() });
}

export type DocGrantKind = z.infer<typeof kind>;
export type DocGrantDto = z.infer<typeof DocGrantContract.entity>;
export type DocGrantListDto = z.infer<typeof DocGrantContract.list>;
export type ListDocGrantsInput = z.infer<typeof DocGrantContract.listQuery>;
export type SaveDocGrantInput = z.infer<typeof DocGrantContract.save>;
export type RevokeDocGrantInput = z.infer<typeof DocGrantContract.revoke>;
