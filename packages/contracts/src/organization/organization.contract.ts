import { z } from "../import.js";
import { Identifiers } from "../primitive/index.js";

// Long enough for any real name, short enough that a pasted paragraph is refused. The
// same bound the auth plugin's `/organization/create` applies.
const NAME_MAX = 80;

export class OrganizationContract {
  private constructor() {}

  // The active organization as its settings page shows it.
  public static readonly entity = z.object({
    id: Identifiers.organizationId,
    name: z.string().min(1),
    slug: z.string().min(1),
    createdAt: z.date(),
  });

  public static readonly get = z.object({});

  public static readonly update = z.object({
    name: z.string().trim().min(1).max(NAME_MAX),
  });

  // The new owner must already be an active member; the caller steps down to `admin`.
  public static readonly transferOwnership = z.object({
    userId: Identifiers.userId,
  });

  // The organization's slug, typed back. A delete is a queued job that ends every
  // membership, so the confirmation is in the request, not only in a dialog.
  public static readonly remove = z.object({
    confirmSlug: z.string().min(1),
  });
}

export type OrganizationDto = z.infer<typeof OrganizationContract.entity>;
export type UpdateOrganizationInput = z.infer<typeof OrganizationContract.update>;
export type TransferOwnershipInput = z.infer<typeof OrganizationContract.transferOwnership>;
export type RemoveOrganizationInput = z.infer<typeof OrganizationContract.remove>;
