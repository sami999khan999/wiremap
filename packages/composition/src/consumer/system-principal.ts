import {
  CapabilitySet,
  type OrganizationId,
  type PermissionKey,
  PermissionRegistry,
  Principal,
  type UserId,
} from "../import.js";

// Narrow, explicit and reviewed — never `PermissionRegistry.instance.all()`, and no
// `core.*`: every resolved principal holds those. `string[]` so `isKnown()` narrows.
const DECLARED: readonly string[] = ["ai.embedding.write", "ai.embedding.read"];

// Checked once at module load, which is what "at boot" has to mean: doing it per call
// spends the work on every job and still reports the rename at 3am rather than at start.
const GRANTS: readonly PermissionKey[] = Object.freeze(
  DECLARED.map((key) => {
    if (!PermissionRegistry.instance.isKnown(key)) {
      throw new Error(`System principal references unknown permission: ${key}`);
    }
    return key;
  }),
);

export class SystemPrincipal {
  private constructor() {}

  // A fixed, reserved uuid rather than the organization's own: an actor column holding a
  // tenant id reads as a user.
  public static readonly USER_ID = "00000000-0000-7000-8000-000000000001";

  // The nil uuid, and it names no row. Platform work belongs to no tenant, so this is a
  // placeholder in a required field rather than an organization anything could resolve.
  private static readonly NIL_ORGANIZATION = "00000000-0000-0000-0000-000000000000";

  // For work that touches no tenant's rows and therefore asserts no permission — sending
  // a queued message, for one. It holds nothing, so a use-case that *did* assert denies.
  public static platform(): Principal {
    return Principal.system(
      SystemPrincipal.NIL_ORGANIZATION as OrganizationId,
      SystemPrincipal.USER_ID as UserId,
      CapabilitySet.from({ wildcard: false, org: { grants: [], denies: [] }, goals: {} }),
    );
  }

  // Every job carries an organization: there is no global data, so a job that processes
  // rows must know whose rows.
  public static forOrganization(organizationId: string): Principal {
    return Principal.system(
      organizationId as OrganizationId,
      SystemPrincipal.USER_ID as UserId,
      CapabilitySet.from({
        wildcard: false,
        org: { grants: GRANTS, denies: [] },
        goals: {},
      }),
    );
  }
}
