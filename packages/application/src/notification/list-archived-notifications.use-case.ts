import { ValidationError } from "../import.js";
import type { ColdArchiveReader, PartitionArchiveGateway } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { PartitionedTable } from "../primitive/index.js";
import type { NotificationPage, NotificationRecord } from "./notification.repository.js";

export interface ListArchivedNotificationsInput {
  readonly period: string;
  readonly limit: number;
  readonly cursor?: string;
}

// One archived month, with how much of it is this tenant's. Not a range: a gap between
// two archived months is a month nobody wrote, and offering it would be a lie.
export interface ArchivedMonth {
  readonly period: string;
  readonly rows: number;
}

const PERIOD = /^\d{4}-\d{2}-01$/;

export class ListArchivedNotificationsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly archive: PartitionArchiveGateway,
    private readonly cold: ColdArchiveReader,
  ) {}

  // The tenant **and the user** off the principal, never off the input. The object on
  // disk holds the whole tenant, so a `userId` input is exactly where the hole would be.
  public async execute(
    actor: Principal,
    input: ListArchivedNotificationsInput,
  ): Promise<NotificationPage> {
    this.authorizer.assert(actor, "notification.archive.read");

    if (!PERIOD.test(input.period)) {
      throw new ValidationError([{ field: "period", rule: "format" }]);
    }

    const [entry] = await this.archive.entriesFor(
      PartitionedTable.NOTIFICATIONS,
      input.period,
      actor.organizationId,
    );
    // A month with no rows for this tenant was never written, so an absent row is an
    // empty page rather than an error.
    if (!entry) return { items: [], nextCursor: null };

    // The cursor is opaque here and decoded by the adapter, the same way the live
    // list's is: what a cursor encodes is not the domain's to know.
    const page = await this.cold.page(entry, actor.userId, input.cursor ?? null, input.limit);

    return {
      items: page.items.map((row) => ListArchivedNotificationsUseCase.recordOf(row)),
      nextCursor: page.nextCursor,
    };
  }

  public async months(actor: Principal): Promise<readonly ArchivedMonth[]> {
    this.authorizer.assert(actor, "notification.archive.read");

    const entries = await this.archive.monthsOf(
      PartitionedTable.NOTIFICATIONS,
      actor.organizationId,
    );

    // `rowCount` is the tenant's whole month, not this user's slice: counting the
    // second would mean reading every object to render a list of months.
    return entries.map((entry) => ({ period: entry.period, rows: entry.rowCount }));
  }

  // The archived line back into the shape the live list returns, so the client renders
  // both with one component. Column names, because this is a row as Postgres wrote it.
  private static recordOf(row: Readonly<Record<string, unknown>>): NotificationRecord {
    return {
      id: String(row.id) as NotificationRecord["id"],
      kind: String(row.kind) as NotificationRecord["kind"],
      category: String(row.category) as NotificationRecord["category"],
      params: (row.params ?? {}) as Record<string, string>,
      link: ListArchivedNotificationsUseCase.textOf(row.link),
      readAt: ListArchivedNotificationsUseCase.dateOf(row.read_at),
      createdAt: new Date(ListArchivedNotificationsUseCase.textOf(row.created_at) ?? ""),
    };
  }

  // Narrowed rather than `String()`d: these come out of JSON, so a column that is
  // null on disk is `null` here and an object would stringify to `[object Object]`.
  private static textOf(value: unknown): string | null {
    return typeof value === "string" ? value : null;
  }

  private static dateOf(value: unknown): Date | null {
    const text = ListArchivedNotificationsUseCase.textOf(value);
    return text === null ? null : new Date(text);
  }
}
