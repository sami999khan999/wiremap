import type {
  DocNavNodeDto,
  DocSpaceAudience,
  DocSpaceFields,
  DocSpaceId,
  DocSpaceRecord,
  DocSpaceRepository,
  DocSpaceSummary,
  OrganizationId,
  Placement,
  UserId,
} from "../../import.js";
import { and, asc, eq, sql } from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { docSpaces } from "../schema/index.js";

// Everything but the tree, which a list never needs and a sidebar needs whole.
const SUMMARY = {
  id: docSpaces.id,
  organizationId: docSpaces.organizationId,
  slug: docSpaces.slug,
  title: docSpaces.title,
  description: docSpaces.description,
  icon: docSpaces.icon,
  audience: docSpaces.audience,
  createdBy: docSpaces.createdBy,
  theme: docSpaces.theme,
  access: docSpaces.access,
  repositoryUrl: docSpaces.repositoryUrl,
  position: docSpaces.position,
  version: docSpaces.version,
  updatedAt: docSpaces.updatedAt,
} as const;

// Routed: the table is tenant-partitioned, so every statement names the tenant and prunes
// to its one partition — the platform organization's spaces included.
export class PgDocSpaceRepository extends BaseRepository implements DocSpaceRepository {
  protected override readonly placement: Placement = "routed";

  public async list(organizationId: OrganizationId): Promise<readonly DocSpaceSummary[]> {
    const rows = await (await this.reader())
      .select(SUMMARY)
      .from(docSpaces)
      .where(eq(docSpaces.organizationId, organizationId))
      .orderBy(asc(docSpaces.position), asc(docSpaces.title));
    return rows.map((row) => PgDocSpaceRepository.summary(row));
  }

  public async findById(
    organizationId: OrganizationId,
    spaceId: DocSpaceId,
  ): Promise<DocSpaceRecord | null> {
    const [row] = await this.db
      .select({ ...SUMMARY, nav: docSpaces.nav })
      .from(docSpaces)
      .where(and(eq(docSpaces.organizationId, organizationId), eq(docSpaces.id, spaceId)))
      .limit(1);
    return row ? { ...PgDocSpaceRepository.summary(row), nav: row.nav } : null;
  }

  // The reader's lookup. Through the replica when the request allows it: a published tree
  // a second behind is still a published tree.
  public async findBySlug(
    organizationId: OrganizationId,
    slug: string,
  ): Promise<DocSpaceRecord | null> {
    const [row] = await (await this.reader())
      .select({ ...SUMMARY, nav: docSpaces.nav })
      .from(docSpaces)
      .where(and(eq(docSpaces.organizationId, organizationId), eq(docSpaces.slug, slug)))
      .limit(1);
    return row ? { ...PgDocSpaceRepository.summary(row), nav: row.nav } : null;
  }

  // Appended after the last space, in the same statement that inserts it.
  public async create(
    organizationId: OrganizationId,
    spaceId: DocSpaceId,
    fields: DocSpaceFields,
    createdBy: UserId,
  ): Promise<boolean> {
    const inserted = await this.db
      .insert(docSpaces)
      .values({
        id: spaceId,
        organizationId,
        ...PgDocSpaceRepository.columns(fields),
        position: sql`(select coalesce(max(${docSpaces.position}) + 1, 0) from ${docSpaces} where ${docSpaces.organizationId} = ${organizationId})`,
        createdBy,
      })
      .onConflictDoNothing()
      .returning({ id: docSpaces.id });
    return inserted.length > 0;
  }

  // The slug check is a read under the transaction the caller holds, then the write. The
  // unique index is still the last word: a racing rename fails the statement instead.
  public async save(
    organizationId: OrganizationId,
    spaceId: DocSpaceId,
    fields: DocSpaceFields,
    position: number,
  ): Promise<boolean> {
    const [taken] = await this.db
      .select({ id: docSpaces.id })
      .from(docSpaces)
      .where(and(eq(docSpaces.organizationId, organizationId), eq(docSpaces.slug, fields.slug)))
      .limit(1);
    if (taken && taken.id !== spaceId) return false;

    await this.db
      .update(docSpaces)
      .set({ ...PgDocSpaceRepository.columns(fields), position, updatedAt: new Date() })
      .where(and(eq(docSpaces.organizationId, organizationId), eq(docSpaces.id, spaceId)));
    return true;
  }

  public async saveNav(
    organizationId: OrganizationId,
    spaceId: DocSpaceId,
    nav: readonly DocNavNodeDto[],
  ): Promise<number> {
    const [row] = await this.db
      .update(docSpaces)
      .set({ nav, version: sql`${docSpaces.version} + 1`, updatedAt: new Date() })
      .where(and(eq(docSpaces.organizationId, organizationId), eq(docSpaces.id, spaceId)))
      .returning({ version: docSpaces.version });
    return row?.version ?? 0;
  }

  public async delete(organizationId: OrganizationId, spaceId: DocSpaceId): Promise<void> {
    await this.db
      .delete(docSpaces)
      .where(and(eq(docSpaces.organizationId, organizationId), eq(docSpaces.id, spaceId)));
  }

  private static columns(fields: DocSpaceFields) {
    return {
      slug: fields.slug,
      title: fields.title,
      description: fields.description,
      icon: fields.icon,
      audience: fields.audience,
      theme: fields.theme,
      access: fields.access,
      repositoryUrl: fields.repositoryUrl,
    };
  }

  // The column is text; the check that it holds one of the three is `DocRules`, on write.
  private static summary<T extends { readonly audience: string }>(
    row: T,
  ): Omit<T, "audience"> & { readonly audience: DocSpaceAudience } {
    return { ...row, audience: row.audience as DocSpaceAudience };
  }
}
