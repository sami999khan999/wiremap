import type { FlagCache } from "../flag/index.js";
import {
  type DocAccessOptionsDto,
  type DocAccessRuleDto,
  type DocNavNodeDto,
  type FlagKey,
  FlagRegistry,
  GATES,
  type ModuleKey,
  ModuleRegistry,
  type OrganizationId,
  PermissionRegistry,
  ValidationError,
} from "../import.js";
import type { EntitlementRepository } from "../platform/index.js";
import type { CacheStore } from "../port/index.js";
import type { Principal } from "../primitive/index.js";

// What one request has read so far, so a tree of a thousand linked pages costs one flag
// read and one plan read, and a tree with no links costs neither.
export interface DocFeatureScope {
  readonly viewer: Principal | null;
  flags?: Promise<ReadonlySet<string>>;
  plan?: Promise<string | null>;
}

// Whether a reader passes a doc's access links. Every link set must pass: each narrows,
// as flags, entitlements and permissions each narrow the one above. See doc.md.
export class DocFeaturePolicy {
  // The same window as capabilities and flags: a plan change reaches the docs in a minute.
  private static readonly PLAN_TTL_SECONDS = 60;

  public constructor(
    private readonly flags: FlagCache,
    private readonly entitlements: EntitlementRepository,
    private readonly cache: CacheStore,
  ) {}

  public scope(viewer: Principal | null): DocFeatureScope {
    return { viewer };
  }

  // False for a signed-out reader on any link, and for a key no registry knows: a link to
  // a feature that is gone hides the doc rather than opening it.
  public async allows(scope: DocFeatureScope, rule: DocAccessRuleDto | null | undefined) {
    if (!DocFeaturePolicy.hasLinks(rule)) return true;
    const viewer = scope.viewer;
    if (!viewer || !rule) return false;

    if (rule.module !== null) {
      if (!Object.hasOwn(GATES, rule.module)) return false;
      if (!ModuleRegistry.instance.isVisible(rule.module as ModuleKey, viewer.capabilities)) {
        return false;
      }
    }
    if (rule.permission !== null) {
      if (!PermissionRegistry.instance.isKnown(rule.permission)) return false;
      if (!viewer.can(rule.permission)) return false;
    }
    if (rule.flag !== null) {
      scope.flags ??= this.flags.onFor(viewer.organizationId).then((keys) => new Set<string>(keys));
      if (!(await scope.flags).has(rule.flag)) return false;
    }
    if (rule.plan !== null) {
      scope.plan ??= this.planOf(viewer.organizationId);
      if ((await scope.plan) !== rule.plan) return false;
    }
    return true;
  }

  // Both a space's rule and a page's, which is what "a page adds to its space" means.
  public async allowsBoth(
    scope: DocFeatureScope,
    space: DocAccessRuleDto | null | undefined,
    page: DocAccessRuleDto | null | undefined,
  ): Promise<boolean> {
    return (await this.allows(scope, space)) && (await this.allows(scope, page));
  }

  // The tree as this reader may see it. A hidden page takes its children with it, and a
  // section left with nothing drops too. A tree with no links is returned as it was.
  public async filterNav(
    scope: DocFeatureScope,
    nav: readonly DocNavNodeDto[],
  ): Promise<readonly DocNavNodeDto[]> {
    if (!DocFeaturePolicy.anyLinked(nav)) return nav;
    const kept: DocNavNodeDto[] = [];
    for (const node of nav) {
      if (!(await this.allows(scope, node.access))) continue;
      const children = await this.filterNav(scope, node.children);
      if (node.kind === "section" && children.length === 0) continue;
      kept.push(children === node.children ? node : { ...node, children });
    }
    return kept;
  }

  // On every write: a key that does not exist would hide the doc from everyone forever.
  public async assertKnown(rule: DocAccessRuleDto | null): Promise<void> {
    if (!rule) return;
    const invalid: { field: string; rule: string }[] = [];
    if (rule.module !== null && !Object.hasOwn(GATES, rule.module)) {
      invalid.push({ field: "access.module", rule: "unknown" });
    }
    if (rule.permission !== null && !DocFeaturePolicy.linkable(rule.permission)) {
      invalid.push({ field: "access.permission", rule: "unknown" });
    }
    if (rule.flag !== null && !FlagRegistry.instance.isKnown(rule.flag)) {
      invalid.push({ field: "access.flag", rule: "unknown" });
    }
    if (rule.plan !== null && !(await this.entitlements.findPlan(rule.plan))) {
      invalid.push({ field: "access.plan", rule: "unknown" });
    }
    if (invalid.length > 0) throw new ValidationError(invalid);
  }

  // What a writer may pick. Tenant permissions only: a platform key is never held inside an
  // organization, so a page linked to one could be read by nobody there.
  public async options(): Promise<DocAccessOptionsDto> {
    const plans = await this.entitlements.findPlans();
    return {
      modules: (Object.keys(GATES) as ModuleKey[]).map((key) => ({ key, label: key })),
      permissions: PermissionRegistry.instance
        .all()
        .filter((key) => DocFeaturePolicy.linkable(key))
        .map((key) => ({ key, label: PermissionRegistry.instance.meta(key)?.label ?? key })),
      flags: FlagRegistry.instance.all().map((key: FlagKey) => ({
        key,
        label: FlagRegistry.instance.meta(key)?.description ?? key,
      })),
      plans: plans.map((plan) => ({ key: plan.key, label: plan.name })),
    };
  }

  public static hasLinks(rule: DocAccessRuleDto | null | undefined): boolean {
    return (
      rule !== null &&
      rule !== undefined &&
      (rule.module !== null || rule.permission !== null || rule.flag !== null || rule.plan !== null)
    );
  }

  private static anyLinked(nav: readonly DocNavNodeDto[]): boolean {
    return nav.some(
      (node) => node.access !== undefined || DocFeaturePolicy.anyLinked(node.children),
    );
  }

  private static linkable(key: string): boolean {
    const registry = PermissionRegistry.instance;
    return registry.isKnown(key) && registry.scopeOf(key) === "org";
  }

  private async planOf(organizationId: OrganizationId): Promise<string | null> {
    const key = `doc:plan:${organizationId}`;
    const cached = await this.cache.get<{ plan: string | null }>(key);
    if (cached) return cached.plan;
    const plan = await this.entitlements.findPlanOf(organizationId);
    await this.cache.set(key, { plan }, DocFeaturePolicy.PLAN_TTL_SECONDS);
    return plan;
  }
}
