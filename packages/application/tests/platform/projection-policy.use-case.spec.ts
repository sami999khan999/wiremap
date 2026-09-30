import { ActivityActions, Identifiers } from "@loadbearing/contracts";
import { ForbiddenError, ValidationError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { ListProjectionPoliciesUseCase } from "../../src/platform/list-projection-policies.use-case.js";
import type { PlatformReader } from "../../src/platform/platform.reader.js";
import type {
  ProjectionPolicyRecord,
  ProjectionPolicyRepository,
} from "../../src/platform/projection-policy.repository.js";
import type {
  RetentionPolicyRecord,
  RetentionPolicyRepository,
} from "../../src/platform/retention-policy.repository.js";
import { UpdateProjectionPolicyUseCase } from "../../src/platform/update-projection-policy.use-case.js";
import type { ActivityLogger, AnalyticsProjector, UnitOfWork } from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";

const PLATFORM = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000001");
const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");

class FakePolicies implements ProjectionPolicyRepository {
  public readonly saved: ProjectionPolicyRecord[] = [];

  public constructor(private rows: readonly ProjectionPolicyRecord[] = []) {}

  public all(): Promise<readonly ProjectionPolicyRecord[]> {
    return Promise.resolve(this.rows);
  }

  public save(record: ProjectionPolicyRecord): Promise<void> {
    this.saved.push(record);
    this.rows = [...this.rows.filter((row) => row.action !== record.action), record];
    return Promise.resolve();
  }
}

class FakeRetention implements Partial<RetentionPolicyRepository> {
  public constructor(private readonly rows: readonly RetentionPolicyRecord[] = []) {}

  public all(): Promise<readonly RetentionPolicyRecord[]> {
    return Promise.resolve(this.rows);
  }
}

class FakeProjector implements Partial<AnalyticsProjector> {
  public readonly applied: string[] = [];

  public constructor(private held = "toDateTime(occurred_at) + toIntervalMonth(60)") {}

  public retention(): Promise<string> {
    return Promise.resolve(this.held);
  }

  public applyRetention(expression: string): Promise<void> {
    this.applied.push(expression);
    this.held = expression;
    return Promise.resolve();
  }
}

class FakeActivity implements ActivityLogger {
  public readonly rows: { organizationId: string; action: string }[] = [];

  public record(actor: Principal, action: string): Promise<void> {
    this.rows.push({ organizationId: actor.organizationId, action });
    return Promise.resolve();
  }
}

const actor = (...platform: readonly PermissionKey[]): Principal =>
  new Principal(
    PLATFORM,
    ACTOR,
    CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: {},
      platform: { grants: platform, denies: [] },
    }),
  );

const platform = {
  organizationId: () => Promise.resolve(PLATFORM),
  organization: () => Promise.resolve({ id: PLATFORM, slug: "platform", name: "Platform" }),
} as unknown as PlatformReader;

const unitOfWork = { run: (work: () => Promise<unknown>) => work() } as unknown as UnitOfWork;

describe("ListProjectionPoliciesUseCase", () => {
  const build = (
    rows: readonly ProjectionPolicyRecord[] = [],
    projector: FakeProjector | null = new FakeProjector(),
  ) =>
    new ListProjectionPoliciesUseCase(
      new Authorizer(),
      new FakePolicies(rows),
      new FakeRetention() as unknown as RetentionPolicyRepository,
      projector as unknown as AnalyticsProjector | null,
    );

  it("refuses an actor without the platform read", async () => {
    await expect(build().execute(actor())).rejects.toBeInstanceOf(ForbiddenError);
  });

  // The screen lists what the system can record, not what somebody has already edited:
  // an action with no row is the interesting case, because it is most of them.
  it("returns one entry per catalog action, defaulted when no row exists", async () => {
    const result = await build().execute(actor("platform.analytics.read"));

    expect(result.actions).toHaveLength(ActivityActions.all().length);
    expect(result.actions.every((entry) => entry.projected && entry.isDefault)).toBe(true);
    expect(result.defaultMonths).toBe(60);
  });

  it("groups by the action's own prefix", async () => {
    const result = await build().execute(actor("platform.analytics.read"));
    const entry = result.actions.find((row) => row.action === "role.created");

    expect(entry?.module).toBe("role");
  });

  it("carries the row's values and marks it not default", async () => {
    const result = await build([
      { action: "ai.document.searched", projected: false, ttlMonths: null },
    ]).execute(actor("platform.analytics.read"));

    const entry = result.actions.find((row) => row.action === "ai.document.searched");
    expect(entry).toMatchObject({ projected: false, isDefault: false });
  });

  // The third state the screen renders — not configured, rather than on or off.
  it("reports an unconfigured store rather than guessing", async () => {
    const result = await build([], null).execute(actor("platform.analytics.read"));

    expect(result.configured).toBe(false);
    expect(result.applied).toBe("");
  });
});

describe("UpdateProjectionPolicyUseCase", () => {
  const build = (
    rows: readonly ProjectionPolicyRecord[] = [],
    projector: FakeProjector | null = new FakeProjector(),
  ) => {
    const policies = new FakePolicies(rows);
    const activity = new FakeActivity();
    const failures: unknown[] = [];

    return {
      policies,
      activity,
      projector,
      failures,
      useCase: new UpdateProjectionPolicyUseCase(
        new Authorizer(),
        policies,
        new FakeRetention() as unknown as RetentionPolicyRepository,
        platform,
        activity,
        unitOfWork,
        projector as unknown as AnalyticsProjector | null,
        (error: unknown) => failures.push(error),
      ),
    };
  };

  const input = { action: "ai.document.searched", projected: false, ttlMonths: null };

  it("refuses an actor without the manage key", async () => {
    await expect(build().useCase.execute(actor(), input)).rejects.toBeInstanceOf(ForbiddenError);
  });

  // The closed union, checked rather than cast: the action is interpolated into a TTL
  // expression, so an unlisted one is a string from a request reaching the store.
  it("refuses an action the catalog does not name", async () => {
    await expect(
      build().useCase.execute(actor("platform.analytics.manage"), {
        ...input,
        action: "role.invented",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a TTL outside one to a hundred and twenty months", async () => {
    for (const ttlMonths of [0, -1, 121, 1.5]) {
      await expect(
        build().useCase.execute(actor("platform.analytics.manage"), { ...input, ttlMonths }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("saves the row and audits under the platform organization", async () => {
    const { useCase, policies, activity } = build();
    await useCase.execute(actor("platform.analytics.manage"), input);

    expect(policies.saved).toEqual([
      { action: "ai.document.searched", projected: false, ttlMonths: null },
    ]);
    expect(activity.rows).toEqual([
      { organizationId: PLATFORM, action: "platform.policy.changed" },
    ]);
  });

  // An excluded action needs no TTL clause: nothing writes it, so a window over it is
  // a rule on rows that do not arrive.
  it("composes a TTL from the projected rows only", async () => {
    const { useCase, projector } = build();
    await useCase.execute(actor("platform.analytics.manage"), {
      action: "role.created",
      projected: true,
      ttlMonths: 120,
    });

    expect(projector?.applied).toEqual([
      "toDateTime(occurred_at) + toIntervalMonth(120) WHERE action = 'role.created', " +
        "toDateTime(occurred_at) + toIntervalMonth(60) WHERE action NOT IN ('role.created')",
    ]);
  });

  // `MODIFY TTL` materialises every existing part, so an unchanged expression must not
  // be re-applied — on a years-deep table that is a rewrite.
  it("writes nothing when the store already holds the composed expression", async () => {
    const { useCase, projector } = build([]);
    await useCase.execute(actor("platform.analytics.manage"), {
      action: "role.created",
      projected: true,
      ttlMonths: null,
    });

    expect(projector?.applied).toEqual([]);
  });

  // The row is the truth and the nightly job closes the gap, so a store that was
  // unreachable must not fail a save that already committed.
  it("logs rather than throws when the store rejects the TTL", async () => {
    const policies = new FakePolicies();
    const failures: unknown[] = [];
    const broken = {
      retention: () => Promise.reject(new Error("unreachable")),
      applyRetention: () => Promise.resolve(),
    } as unknown as AnalyticsProjector;

    const useCase = new UpdateProjectionPolicyUseCase(
      new Authorizer(),
      policies,
      new FakeRetention() as unknown as RetentionPolicyRepository,
      platform,
      new FakeActivity(),
      unitOfWork,
      broken,
      (error: unknown) => failures.push(error),
    );

    await expect(
      useCase.execute(actor("platform.analytics.manage"), input),
    ).resolves.toBeUndefined();
    expect(failures).toHaveLength(1);
    expect(policies.saved).toHaveLength(1);
  });

  // A deployment running no analytics store must still be able to edit the policy: the
  // rows are what the consumer reads when one is started later.
  it("saves with no analytics store configured", async () => {
    const { useCase, policies } = build([], null);
    await useCase.execute(actor("platform.analytics.manage"), input);

    expect(policies.saved).toHaveLength(1);
  });
});
