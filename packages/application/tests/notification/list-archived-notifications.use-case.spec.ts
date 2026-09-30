import { Identifiers } from "@loadbearing/contracts";
import { ForbiddenError, ValidationError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { ListArchivedNotificationsUseCase } from "../../src/notification/list-archived-notifications.use-case.js";
import type {
  ColdArchiveReader,
  ColdPage,
  PartitionArchiveEntry,
  PartitionArchiveGateway,
} from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const OTHER = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000020");
const MINE = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const THEIRS = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000012");

const entry = (organizationId: string): PartitionArchiveEntry =>
  ({
    organizationId,
    tableName: "notifications",
    period: "2026-01-01",
    objectKey: `cold/notifications/2026/01/${organizationId}.ndjson.gz`,
    rowCount: 2,
    bytes: 64,
    checksum: "x",
    actionCounts: {},
    projectedAt: null,
  }) as PartitionArchiveEntry;

// Records what it was asked for. The tenant on the entry it returns is the whole point:
// a use-case reading the input's tenant would fetch somebody else's object.
class FakeArchive implements Partial<PartitionArchiveGateway> {
  public readonly asked: { period: string; organizationId?: string }[] = [];

  public constructor(private readonly entries: readonly PartitionArchiveEntry[] = []) {}

  public entriesFor(
    _table: string,
    period: string,
    organizationId?: string,
  ): Promise<readonly PartitionArchiveEntry[]> {
    this.asked.push({ period, organizationId });
    return Promise.resolve(
      this.entries.filter((one) => !organizationId || one.organizationId === organizationId),
    );
  }

  public monthsOf(
    _table: string,
    organizationId: string,
  ): Promise<readonly PartitionArchiveEntry[]> {
    return Promise.resolve(this.entries.filter((one) => one.organizationId === organizationId));
  }
}

// Holds both users' rows, which is what the object on disk does: the filter is the
// only thing between one user and the whole tenant's month.
class FakeCold implements Partial<ColdArchiveReader> {
  public readonly asked: string[] = [];

  public page(
    _entry: PartitionArchiveEntry,
    userId: string,
    cursor: string | null,
    limit: number,
  ): Promise<ColdPage> {
    this.asked.push(userId);

    const rows = [
      {
        id: "n1",
        user_id: MINE,
        kind: "member.joined",
        params: {},
        link: null,
        read_at: null,
        created_at: "2026-01-02T00:00:00.000Z",
        category: "member",
      },
      {
        id: "n2",
        user_id: THEIRS,
        kind: "member.joined",
        params: {},
        link: null,
        read_at: null,
        created_at: "2026-01-03T00:00:00.000Z",
        category: "member",
      },
    ].filter((row) => row.user_id === userId);

    const from = cursor === null ? 0 : Number(cursor);
    const items = rows.slice(from, from + limit);
    const next = from + items.length;

    return Promise.resolve({ items, nextCursor: next < rows.length ? String(next) : null });
  }
}

const actor = (organizationId = ORG, userId = MINE, ...keys: readonly PermissionKey[]): Principal =>
  new Principal(
    organizationId,
    userId,
    CapabilitySet.from({
      wildcard: false,
      org: { grants: keys, denies: [] },
      goals: {},
      platform: { grants: [], denies: [] },
    }),
  );

const build = (entries: readonly PartitionArchiveEntry[] = [entry(ORG)]) => {
  const archive = new FakeArchive(entries);
  const cold = new FakeCold();

  return {
    archive,
    cold,
    useCase: new ListArchivedNotificationsUseCase(
      new Authorizer(),
      archive as unknown as PartitionArchiveGateway,
      cold as unknown as ColdArchiveReader,
    ),
  };
};

const input = { period: "2026-01-01", limit: 25 };

describe("ListArchivedNotificationsUseCase", () => {
  it("refuses an actor without the archive key", async () => {
    await expect(build().useCase.execute(actor(), input)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a period that is not the first of a month", async () => {
    await expect(
      build().useCase.execute(actor(ORG, MINE, "notification.archive.read"), {
        ...input,
        period: "2026-01-15",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // **The hole this use-case is most likely to open.** The object on disk holds the
  // whole tenant, so the tenant and the user both come off the principal.
  it("reads the tenant and the user off the principal, never the input", async () => {
    const { archive, cold, useCase } = build();

    await useCase.execute(actor(ORG, MINE, "notification.archive.read"), input);

    expect(archive.asked).toEqual([{ period: "2026-01-01", organizationId: ORG }]);
    expect(cold.asked).toEqual([MINE]);
  });

  it("returns only the actor's own rows out of a shared object", async () => {
    const { useCase } = build();

    const page = await useCase.execute(actor(ORG, MINE, "notification.archive.read"), input);

    expect(page.items.map((row) => row.id)).toEqual(["n1"]);
  });

  // Another tenant asking for the same month gets nothing, because the object it would
  // need is not one `entriesFor` will hand them.
  it("gives a user in another organization nothing for the same month", async () => {
    const { useCase } = build();

    const page = await useCase.execute(actor(OTHER, THEIRS, "notification.archive.read"), input);

    expect(page).toEqual({ items: [], nextCursor: null });
  });

  // A month with no rows for this tenant was never written, so an absent row is an
  // empty page rather than an error a screen has to explain.
  it("is an empty page for a month nobody archived", async () => {
    const { useCase } = build([]);

    await expect(
      useCase.execute(actor(ORG, MINE, "notification.archive.read"), input),
    ).resolves.toEqual({ items: [], nextCursor: null });
  });

  it("lists only this tenant's archived months", async () => {
    const { useCase } = build([entry(ORG), entry(OTHER)]);

    const months = await useCase.months(actor(ORG, MINE, "notification.archive.read"));

    expect(months).toEqual([{ period: "2026-01-01", rows: 2 }]);
  });

  it("refuses the month list without the key too", async () => {
    await expect(build().useCase.months(actor())).rejects.toBeInstanceOf(ForbiddenError);
  });
});
