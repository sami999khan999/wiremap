import { Identifiers, type OrganizationId, type UserId } from "@loadbearing/contracts";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { FlagCache } from "../../src/flag/flag.cache.js";
import type { FlagRecord, FlagRepository } from "../../src/flag/flag.repository.js";
import type {
  ActivityLogger,
  CacheStore,
  TenantMembershipReader,
  UnitOfWork,
} from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";
import { GetWidgetPreferencesUseCase } from "../../src/widget/get-widget-preferences.use-case.js";
import { UpdateWidgetDefaultUseCase } from "../../src/widget/update-widget-default.use-case.js";
import { UpdateWidgetPreferenceUseCase } from "../../src/widget/update-widget-preference.use-case.js";
import {
  WidgetPreferenceRepository,
  type WidgetPreferences,
} from "../../src/widget/widget-preference.repository.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const OTHER = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000020");
const ADA = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const GRACE = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000012");

class MemoryPreferences extends WidgetPreferenceRepository {
  public readonly rows = new Set<string>();

  public override findFor(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<WidgetPreferences> {
    const split = [...this.rows].map((row) => row.split("|"));
    return Promise.resolve({
      hiddenByAdmin: split
        .filter(([o, u]) => o === organizationId && u === "")
        .map(([, , w]) => w ?? ""),
      hiddenByUser: split
        .filter(([o, u]) => o === organizationId && u === userId)
        .map(([, , w]) => w ?? ""),
    });
  }

  public override save(organizationId: OrganizationId, userId: UserId | null, widget: string) {
    this.rows.add(`${organizationId}|${userId ?? ""}|${widget}`);
    return Promise.resolve();
  }

  public override delete(organizationId: OrganizationId, userId: UserId | null, widget: string) {
    this.rows.delete(`${organizationId}|${userId ?? ""}|${widget}`);
    return Promise.resolve();
  }
}

// `widget.dismissal` on for `ORG` alone, the way a targeted rollout starts.
function flags(): FlagCache {
  const rows: FlagRecord[] = [
    {
      key: "widget.dismissal",
      isEnabled: false,
      targets: [{ organizationId: ORG, slug: "org" }],
      updatedAt: new Date(0),
    },
  ];
  const repository = { findAll: () => Promise.resolve(rows) } as unknown as FlagRepository;
  const cache = {
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  } as unknown as CacheStore;
  return new FlagCache(repository, cache);
}

function harness() {
  const preferences = new MemoryPreferences();
  const recorded: string[] = [];
  const activity: ActivityLogger = {
    record: (_actor, action) => {
      recorded.push(action);
      return Promise.resolve();
    },
  };
  const unitOfWork = { run: <T>(work: () => Promise<T>) => work() } as UnitOfWork;
  const memberships = {
    isActiveMember: (_org: OrganizationId, userId: UserId) => Promise.resolve(userId === GRACE),
  } as unknown as TenantMembershipReader;
  const authorizer = new Authorizer();
  return {
    preferences,
    recorded,
    get: new GetWidgetPreferencesUseCase(authorizer, preferences, memberships),
    update: new UpdateWidgetPreferenceUseCase(authorizer, flags(), preferences),
    updateDefault: new UpdateWidgetDefaultUseCase(
      authorizer,
      flags(),
      preferences,
      activity,
      unitOfWork,
    ),
  };
}

const actor = (organizationId: OrganizationId, ...grants: readonly PermissionKey[]) =>
  new Principal(
    organizationId,
    ADA,
    CapabilitySet.from({ wildcard: false, org: { grants: [...grants], denies: [] }, goals: {} }),
  );

describe("UpdateWidgetPreferenceUseCase", () => {
  it("hides and restores a dismissible card for its own user", async () => {
    const { update, get } = harness();

    await update.execute(actor(ORG), { widget: "member.count", hidden: true });
    expect(await get.execute(actor(ORG), {})).toEqual({
      hiddenByAdmin: [],
      hiddenByUser: ["member.count"],
    });

    await update.execute(actor(ORG), { widget: "member.count", hidden: false });
    expect((await get.execute(actor(ORG), {})).hiddenByUser).toEqual([]);
  });

  // The flag before the permission, and the error names no flag: `toJSON()` reaches the browser.
  it("answers NOT_FOUND with no flag key where the flag is off", async () => {
    const { update } = harness();

    const error = await update
      .execute(actor(OTHER), { widget: "member.count", hidden: true })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(NotFoundError);
    expect(JSON.stringify((error as NotFoundError).toJSON())).not.toContain("widget.dismissal");
  });

  // The nav is the last path to every capability, so it is never hidden.
  it("refuses a required widget and an unknown one", async () => {
    const { update } = harness();

    for (const widget of ["core.module-nav", "no.such.widget"]) {
      await expect(update.execute(actor(ORG), { widget, hidden: true })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
  });

  it("refuses to restore a card the admin hid for everyone", async () => {
    const { update, preferences } = harness();
    await preferences.save(ORG, null, "member.count");

    await expect(
      update.execute(actor(ORG), { widget: "member.count", hidden: false }),
    ).rejects.toMatchObject({ code: "CONFLICT", context: { reason: "hidden-by-admin" } });
  });
});

describe("UpdateWidgetDefaultUseCase", () => {
  it("hides a card for everyone, audited both ways", async () => {
    const { updateDefault, get, recorded } = harness();
    const admin = actor(ORG, "widget.default.manage");

    await updateDefault.execute(admin, { widget: "member.count", hidden: true });
    expect((await get.execute(actor(ORG), {})).hiddenByAdmin).toEqual(["member.count"]);

    await updateDefault.execute(admin, { widget: "member.count", hidden: false });
    expect(recorded).toEqual(["widget.default.hidden", "widget.default.restored"]);
  });

  it("needs the manage key, and still asks the flag first", async () => {
    const { updateDefault } = harness();

    await expect(
      updateDefault.execute(actor(ORG), { widget: "member.count", hidden: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateDefault.execute(actor(OTHER), { widget: "member.count", hidden: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("GetWidgetPreferencesUseCase", () => {
  it("reads another member's only with the inspector's key, and only for a member", async () => {
    const { get } = harness();

    await expect(get.execute(actor(ORG), { userId: GRACE })).rejects.toBeInstanceOf(ForbiddenError);
    const inspector = actor(ORG, "rbac.effective.inspect");
    expect(await get.execute(inspector, { userId: GRACE })).toEqual({
      hiddenByAdmin: [],
      hiddenByUser: [],
    });
    await expect(
      get.execute(inspector, {
        userId: Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000099"),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
