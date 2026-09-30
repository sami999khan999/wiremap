import { Identifiers, type OrganizationId, type UserId } from "@loadbearing/contracts";
import { ConflictError, ForbiddenError, NotFoundError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import type { FlagCache } from "../../src/flag/flag.cache.js";
import { type FlagRecord, FlagRepository } from "../../src/flag/flag.repository.js";
import { ListFlagsUseCase } from "../../src/platform/list-flags.use-case.js";
import type { PlatformReader } from "../../src/platform/platform.reader.js";
import type { ShardMapReader, ShardTenant } from "../../src/platform/shard-map.reader.js";
import { UpdateFlagUseCase } from "../../src/platform/update-flag.use-case.js";
import { UpdateFlagTargetUseCase } from "../../src/platform/update-flag-target.use-case.js";
import type { ActivityLogger, UnitOfWork } from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";

const PLATFORM = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000001");
const TENANT = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");

class MemoryFlags extends FlagRepository {
  public readonly rows = new Map<string, FlagRecord>();

  public override findAll(): Promise<readonly FlagRecord[]> {
    return Promise.resolve([...this.rows.values()]);
  }

  public override save(key: string, isEnabled: boolean, _actor: UserId): Promise<void> {
    const current = this.rows.get(key);
    this.rows.set(key, { key, isEnabled, targets: current?.targets ?? [], updatedAt: null });
    return Promise.resolve();
  }

  public override saveTarget(key: string, organizationId: OrganizationId): Promise<void> {
    const current = this.rows.get(key);
    const targets = [...(current?.targets ?? []), { organizationId, slug: "acme" }];
    this.rows.set(key, { key, isEnabled: current?.isEnabled ?? false, targets, updatedAt: null });
    return Promise.resolve();
  }

  public override deleteTarget(key: string, organizationId: OrganizationId): Promise<void> {
    const current = this.rows.get(key);
    if (!current) return Promise.resolve();
    const targets = current.targets.filter((t) => t.organizationId !== organizationId);
    this.rows.set(key, { ...current, targets });
    return Promise.resolve();
  }
}

const TENANT_ROW: ShardTenant = {
  organizationId: TENANT,
  slug: "acme",
  name: "Acme",
  node: 0,
  assignedAt: new Date(0),
  movedAt: null,
  retentionOverrides: 0,
};

function harness() {
  const flags = new MemoryFlags();
  const recorded: { organizationId: string; action: string; payload: unknown }[] = [];
  let invalidations = 0;
  const activity: ActivityLogger = {
    record: (actor, action, payload) => {
      recorded.push({ organizationId: actor.organizationId, action, payload });
      return Promise.resolve();
    },
  };
  const cache = {
    invalidate: () => {
      invalidations += 1;
      return Promise.resolve();
    },
  } as unknown as FlagCache;
  const unitOfWork = { run: <T>(work: () => Promise<T>) => work() } as UnitOfWork;
  const platform = { organizationId: () => Promise.resolve(PLATFORM) } as PlatformReader;
  const tenants = {
    findByTerm: (term: string) =>
      Promise.resolve(term === "acme" || term === TENANT ? TENANT_ROW : null),
  } as ShardMapReader;
  const authorizer = new Authorizer();

  return {
    flags,
    recorded,
    invalidations: () => invalidations,
    list: new ListFlagsUseCase(authorizer, flags),
    update: new UpdateFlagUseCase(authorizer, flags, cache, platform, activity, unitOfWork),
    target: new UpdateFlagTargetUseCase(
      authorizer,
      flags,
      cache,
      tenants,
      platform,
      activity,
      unitOfWork,
    ),
  };
}

const actor = (platform: readonly PermissionKey[]) =>
  new Principal(
    TENANT,
    ACTOR,
    CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: {},
      platform: { grants: platform, denies: [] },
    }),
  );

const admin = actor(["platform.flag.read", "platform.flag.manage"]);

describe("ListFlagsUseCase", () => {
  it("lists every declared flag with its owner, off when it has no row", async () => {
    const { list } = harness();

    const [dismissal] = await list.execute(admin);

    expect(dismissal).toMatchObject({
      key: "widget.dismissal",
      owner: "sami",
      isEnabled: false,
      targets: [],
      orphaned: false,
    });
  });

  it("marks a row the code no longer declares as orphaned", async () => {
    const { list, flags } = harness();
    await flags.save("retired.flag", true, ACTOR);

    const orphan = (await list.execute(admin)).find((flag) => flag.key === "retired.flag");

    expect(orphan).toMatchObject({ orphaned: true, owner: null, isEnabled: true });
  });

  it("refuses a caller without platform.flag.read", async () => {
    const { list } = harness();

    await expect(list.execute(actor([]))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("UpdateFlagUseCase", () => {
  it("switches a flag, audits it in the tier, and invalidates after the write", async () => {
    const { update, flags, recorded, invalidations } = harness();

    await update.execute(admin, { key: "widget.dismissal", enabled: true });

    expect(flags.rows.get("widget.dismissal")?.isEnabled).toBe(true);
    expect(recorded).toEqual([
      { organizationId: PLATFORM, action: "flag.enabled", payload: { key: "widget.dismissal" } },
    ]);
    expect(invalidations()).toBe(1);
  });

  // Turning an orphan off is how a retired flag's row is cleared; turning it on would
  // switch something no code reads.
  it("switches an orphaned row off, never on", async () => {
    const { update, flags } = harness();
    await flags.save("retired.flag", true, ACTOR);

    await update.execute(admin, { key: "retired.flag", enabled: false });
    expect(flags.rows.get("retired.flag")?.isEnabled).toBe(false);

    await expect(
      update.execute(admin, { key: "retired.flag", enabled: true }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("answers NOT_FOUND for a key that is neither declared nor stored", async () => {
    const { update } = harness();

    await expect(update.execute(admin, { key: "no.such", enabled: false })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("refuses a caller who may read flags but not switch them", async () => {
    const { update, recorded } = harness();

    await expect(
      update.execute(actor(["platform.flag.read"]), { key: "widget.dismissal", enabled: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(recorded).toEqual([]);
  });
});

describe("UpdateFlagTargetUseCase", () => {
  it("turns a flag on for one org named by slug, and off again", async () => {
    const { target, flags, recorded } = harness();

    await target.execute(admin, { key: "widget.dismissal", organization: " acme ", enabled: true });
    expect(flags.rows.get("widget.dismissal")?.targets).toEqual([
      { organizationId: TENANT, slug: "acme" },
    ]);

    await target.execute(admin, { key: "widget.dismissal", organization: TENANT, enabled: false });
    expect(flags.rows.get("widget.dismissal")?.targets).toEqual([]);

    expect(recorded.map((entry) => entry.action)).toEqual([
      "flag.organization.added",
      "flag.organization.removed",
    ]);
    expect(recorded.every((entry) => entry.organizationId === PLATFORM)).toBe(true);
  });

  it("answers NOT_FOUND for a tenant nothing answers to, and for an undeclared flag", async () => {
    const { target } = harness();

    await expect(
      target.execute(admin, { key: "widget.dismissal", organization: "nobody", enabled: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      target.execute(admin, { key: "retired.flag", organization: "acme", enabled: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
