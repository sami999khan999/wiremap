import { type ApiKeyId, Identifiers, type OrganizationId } from "@loadbearing/contracts";
import { ForbiddenError, NotFoundError, ValidationError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  ApiKeyPage,
  ApiKeyRepository,
  ApiKeySummary,
  NewApiKey,
} from "../../src/apikey/api-key.repository.js";
import { CreateApiKeyUseCase } from "../../src/apikey/create-api-key.use-case.js";
import { ListApiKeysUseCase } from "../../src/apikey/list-api-keys.use-case.js";
import { RevokeApiKeyUseCase } from "../../src/apikey/revoke-api-key.use-case.js";
import type { ActivityLogger, UnitOfWork } from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const KEY = Identifiers.apiKeyId.parse("018f8c00-0000-7000-8000-0000000000e1");
const NOW = new Date("2026-09-06T00:00:00.000Z");
const CLOCK = { now: () => NOW };

function actorHolding(...grants: readonly PermissionKey[]): Principal {
  return new Principal(
    ORG,
    ACTOR,
    CapabilitySet.from({ wildcard: false, org: { grants, denies: [] }, goals: {} }),
  );
}

function summary(overrides: Partial<ApiKeySummary> = {}): ApiKeySummary {
  return {
    id: KEY,
    name: "CI",
    prefix: "rk_abcde",
    issuerId: ACTOR,
    scopes: ["member.read"],
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

class RecordingKeys implements ApiKeyRepository {
  public readonly created: NewApiKey[] = [];
  public readonly revoked: { id: ApiKeyId; at: Date }[] = [];

  public constructor(private readonly rows: readonly ApiKeySummary[] = []) {}

  public findByPrefix(): Promise<readonly never[]> {
    throw new Error("not under test");
  }

  public touch(): Promise<void> {
    throw new Error("not under test");
  }

  public listByOrganization(organizationId: OrganizationId): Promise<ApiKeyPage> {
    if (organizationId !== ORG) return Promise.resolve({ items: [], total: 0 });
    return Promise.resolve({ items: this.rows, total: this.rows.length });
  }

  public findById(organizationId: OrganizationId, id: ApiKeyId): Promise<ApiKeySummary | null> {
    if (organizationId !== ORG) return Promise.resolve(null);
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }

  public create(_org: OrganizationId, key: NewApiKey): Promise<void> {
    this.created.push(key);
    return Promise.resolve();
  }

  public revoke(_org: OrganizationId, id: ApiKeyId, at: Date): Promise<void> {
    this.revoked.push({ id, at });
    return Promise.resolve();
  }
}

class RecordingActivityLogger implements ActivityLogger {
  public readonly records: { action: string; payload: Record<string, unknown> }[] = [];

  public record(
    _actor: Principal,
    action: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    this.records.push({ action, payload: { ...payload } });
    return Promise.resolve();
  }
}

class DirectUnitOfWork implements UnitOfWork {
  public run<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

let keys: RecordingKeys;
let activity: RecordingActivityLogger;

function reset(rows: readonly ApiKeySummary[] = []): void {
  keys = new RecordingKeys(rows);
  activity = new RecordingActivityLogger();
}

const list = () => new ListApiKeysUseCase(new Authorizer(), keys);
const create = () =>
  new CreateApiKeyUseCase(new Authorizer(), keys, activity, new DirectUnitOfWork(), CLOCK);
const revoke = () =>
  new RevokeApiKeyUseCase(new Authorizer(), keys, activity, new DirectUnitOfWork(), CLOCK);

const PAGE = { limit: 25, offset: 0 };

beforeEach(() => reset());

describe("ListApiKeysUseCase", () => {
  it("refuses a principal without apikey.read", async () => {
    await expect(list().execute(actorHolding("member.read"), PAGE)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("reads only the actor's own tenant", async () => {
    reset([summary()]);
    const result = await list().execute(actorHolding("apikey.read"), PAGE);

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});

describe("CreateApiKeyUseCase", () => {
  // A project scope holds in every project, so only someone holding it organization-wide
  // may hand it to a key; a grant in one project is not enough.
  it("issues a project scope to an org-wide holder and refuses a one-project holder", async () => {
    const input = { name: "CLI", scopes: ["project.scan.run"], expiresAt: null };
    await expect(
      create().execute(actorHolding("apikey.manage", "project.scan.run"), input),
    ).resolves.toBeDefined();
    const onOne = new Principal(
      ORG,
      ACTOR,
      CapabilitySet.from({
        wildcard: false,
        org: { grants: ["apikey.manage"], denies: [] },
        goals: {
          "018f8c00-0000-7000-8000-0000000000c1": { grants: ["project.scan.run"], denies: [] },
        },
      }),
    );
    await expect(create().execute(onOne, input)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a principal without apikey.manage", async () => {
    await expect(
      create().execute(actorHolding("apikey.read"), {
        name: "CI",
        scopes: ["member.read"],
        expiresAt: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // `CR.3`. A leaked short-lived key with `apikey.manage` minted a permanent sibling, which
  // is the issuer's and so survived the parent's revocation.
  it("refuses a key minting a key, even one holding apikey.manage", async () => {
    const key = Principal.apiKey(
      ORG,
      ACTOR,
      CapabilitySet.from({
        wildcard: false,
        org: { grants: ["apikey.manage", "member.read"], denies: [] },
        goals: {},
      }),
    );

    await expect(
      create().execute(key, { name: "CI", scopes: ["member.read"], expiresAt: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(keys.created).toEqual([]);
  });

  it("returns the token once and stores only a digest", async () => {
    const result = await create().execute(actorHolding("apikey.manage", "member.read"), {
      name: "CI",
      scopes: ["member.read"],
      expiresAt: null,
    });

    expect(result.token).toMatch(/^rk_[0-9a-f]{64}$/);
    // The token reaches the caller and nothing else. What was written is the digest,
    // and it is not the token.
    const written = keys.created[0];
    expect(written?.tokenHash).toBeDefined();
    expect(written?.tokenHash).not.toBe(result.token);
    expect(result.token.startsWith(written?.prefix ?? "")).toBe(true);
  });

  // Without this, `apikey.manage` is the only key anyone needs: mint a key holding
  // everything, then use it.
  it("refuses a scope the actor does not hold", async () => {
    await expect(
      create().execute(actorHolding("apikey.manage"), {
        name: "CI",
        scopes: ["member.deactivate"],
        expiresAt: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(keys.created).toEqual([]);
  });

  it("lets a wildcard principal mint a scope it never names", async () => {
    const owner = new Principal(
      ORG,
      ACTOR,
      CapabilitySet.from({ wildcard: true, org: { grants: [], denies: [] }, goals: {} }),
    );

    const result = await create().execute(owner, {
      name: "CI",
      scopes: ["member.deactivate"],
      expiresAt: null,
    });

    expect(result.key.scopes).toEqual(["member.deactivate"]);
  });

  it("refuses a scope the catalog does not know", async () => {
    await expect(
      create().execute(actorHolding("apikey.manage"), {
        name: "CI",
        scopes: ["member.raed"],
        expiresAt: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // A key born expired authenticates nothing and reads as working in the list.
  it("refuses an expiry already in the past", async () => {
    await expect(
      create().execute(actorHolding("apikey.manage", "member.read"), {
        name: "CI",
        scopes: ["member.read"],
        expiresAt: new Date(NOW.getTime() - 1000),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // The audit row records that a credential was issued and what it can do — never the
  // credential, which would undo the reason it is only ever hashed.
  it("records the creation without the token", async () => {
    const result = await create().execute(actorHolding("apikey.manage", "member.read"), {
      name: "CI",
      scopes: ["member.read"],
      expiresAt: null,
    });

    expect(activity.records.map((r) => r.action)).toEqual(["apikey.created"]);
    expect(JSON.stringify(activity.records)).not.toContain(result.token);
  });
});

describe("RevokeApiKeyUseCase", () => {
  it("does not find a key in another tenant", async () => {
    reset([summary()]);
    const foreign = new Principal(
      Identifiers.organizationId.parse("018f8c00-0000-7000-8000-0000000000ff"),
      ACTOR,
      CapabilitySet.from({
        wildcard: false,
        org: { grants: ["apikey.manage"], denies: [] },
        goals: {},
      }),
    );

    await expect(revoke().execute(foreign, { apiKeyId: KEY })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("stamps the clock and records it", async () => {
    reset([summary()]);
    const result = await revoke().execute(actorHolding("apikey.manage"), { apiKeyId: KEY });

    expect(result.revokedAt).toEqual(NOW);
    expect(keys.revoked).toEqual([{ id: KEY, at: NOW }]);
    expect(activity.records.map((r) => r.action)).toEqual(["apikey.revoked"]);
  });

  // Re-revoking must not rewrite when the credential actually stopped working — that
  // timestamp is what an incident review reads.
  it("keeps the original timestamp on a second revoke", async () => {
    const first = new Date("2026-09-01T00:00:00.000Z");
    reset([summary({ revokedAt: first })]);

    const result = await revoke().execute(actorHolding("apikey.manage"), { apiKeyId: KEY });

    expect(result.revokedAt).toEqual(first);
    expect(keys.revoked).toEqual([]);
    expect(activity.records).toEqual([]);
  });
});
