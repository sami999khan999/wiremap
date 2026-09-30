import { NotFoundError, type OrganizationId, type PermissionKey } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { CapabilityRepository, RoleRepository } from "../rbac/index.js";
import type { AdjustmentRecord, EntitlementRepository } from "./entitlement.repository.js";
import { EntitlementRules } from "./entitlement.rules.js";
import type { ShardMapReader } from "./shard-map.reader.js";

export interface GetOrganizationEntitlementInput {
  // An organization id or a slug, whichever the operator is holding.
  readonly organization: string;
}

// One role against the ceiling: what it lists, and how much of that the plan lets through.
export interface RoleCoverage {
  readonly key: string;
  readonly name: string;
  readonly listed: number;
  readonly entitled: number;
}

export interface OrganizationEntitlement {
  readonly organization: {
    readonly id: OrganizationId;
    readonly slug: string;
    readonly name: string;
  };
  readonly planKey: string;
  readonly adjustments: readonly AdjustmentRecord[];
  // Tenant keys only: `core` and `platform` are outside the mask, so counting them would
  // tell every plan apart from nothing.
  readonly entitled: readonly PermissionKey[];
  readonly roles: readonly RoleCoverage[];
}

// The one page that answers "what can this org do, and why": its plan, its adjustments,
// and the effective result against the roles it actually has.
export class GetOrganizationEntitlementUseCase {
  // A tenant's roles fit in one page; a tenant with more is one this screen cannot help.
  private static readonly ROLE_PAGE = 100;

  public constructor(
    private readonly authorizer: Authorizer,
    private readonly entitlements: EntitlementRepository,
    private readonly capabilities: CapabilityRepository,
    private readonly roles: RoleRepository,
    private readonly tenants: ShardMapReader,
  ) {}

  public async execute(
    actor: Principal,
    input: GetOrganizationEntitlementInput,
  ): Promise<OrganizationEntitlement> {
    this.authorizer.assert(actor, "platform.entitlement.read");

    const term = input.organization.trim();
    const tenant = await this.tenants.findByTerm(term);
    if (!tenant) throw new NotFoundError("organization", term);
    const organizationId = tenant.organizationId;

    const [planKey, adjustments, mask, roles] = await Promise.all([
      this.entitlements.findPlanOf(organizationId),
      this.entitlements.findAdjustments(organizationId),
      this.capabilities.entitlementFor(organizationId),
      this.roles.list(organizationId, {
        limit: GetOrganizationEntitlementUseCase.ROLE_PAGE,
        offset: 0,
      }),
    ]);

    const maskable = new Set<string>(EntitlementRules.maskableKeys());
    const entitled = mask.keys().filter((key) => maskable.has(key));
    const allowed = new Set<string>(entitled);

    return {
      organization: { id: organizationId, slug: tenant.slug, name: tenant.name },
      planKey: planKey ?? "",
      adjustments,
      entitled,
      roles: roles.items
        .filter((role) => role.scope === "org")
        .map((role) => {
          const listed = role.permissions.filter((key) => maskable.has(key));
          return {
            key: role.key,
            name: role.name,
            listed: listed.length,
            entitled: listed.filter((key) => allowed.has(key)).length,
          };
        }),
    };
  }
}
