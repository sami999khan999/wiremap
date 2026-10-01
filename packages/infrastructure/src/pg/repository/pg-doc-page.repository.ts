import type {
  DocDraftFields,
  DocPageDraftRecord,
  DocPageId,
  DocPageKind,
  DocPageNodeRecord,
  DocPagePublishedRecord,
  DocPageRepository,
  DocPublication,
  DocRendering,
  DocRevisionRecord,
  DocRevisionSummaryRecord,
  DocSearchMatch,
  DocSpaceId,
  DocStalePageRecord,
  NewDocPage,
  OrganizationId,
  Placement,
  RenderedSection,
  UserId,
} from "../../import.js";
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql, Uuid } from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { docPages, docRevision, docSections } from "../schema/index.js";

// A page with no history worth a screen of its own is still a page someone publishes
// daily. The editor lists the newest; older ones stay reachable by number.
const REVISION_PAGE = 200;

// The tree's columns and nothing else. Both bodies are TOASTed, and naming them here would
// fetch two copies of every page to draw a sidebar.
const NODE = {
  id: docPages.id,
  spaceId: docPages.spaceId,
  parentId: docPages.parentId,
  kind: docPages.kind,
  slug: docPages.slug,
  title: docPages.title,
  icon: docPages.icon,
  url: docPages.url,
  access: docPages.access,
  position: docPages.position,
  draftVersion: docPages.draftVersion,
  publishedDraftVersion: docPages.publishedDraftVersion,
  publishedTitle: docPages.publishedTitle,
  revisionNo: docPages.revisionNo,
  publishedAt: docPages.publishedAt,
  updatedAt: docPages.updatedAt,
} as const;

// Routed and tenant-partitioned, like its three tables. Every statement names the tenant.
export class PgDocPageRepository extends BaseRepository implements DocPageRepository {
  protected override readonly placement: Placement = "routed";

  public async listBySpace(
    organizationId: OrganizationId,
    spaceId: DocSpaceId,
  ): Promise<readonly DocPageNodeRecord[]> {
    const rows = await this.db
      .select(NODE)
      .from(docPages)
      .where(and(eq(docPages.organizationId, organizationId), eq(docPages.spaceId, spaceId)));
    return rows.map((row) => PgDocPageRepository.node(row));
  }

  public async findDraft(
    organizationId: OrganizationId,
    pageId: DocPageId,
  ): Promise<DocPageDraftRecord | null> {
    const [row] = await this.db
      .select({ ...NODE, description: docPages.description, markdown: docPages.markdown })
      .from(docPages)
      .where(and(eq(docPages.organizationId, organizationId), eq(docPages.id, pageId)))
      .limit(1);
    return row
      ? { ...PgDocPageRepository.node(row), description: row.description, markdown: row.markdown }
      : null;
  }

  // The reader's one query on a cache miss, and a replica may answer it.
  public async findPublished(
    organizationId: OrganizationId,
    pageId: DocPageId,
  ): Promise<DocPagePublishedRecord | null> {
    const [row] = await (await this.reader())
      .select({
        id: docPages.id,
        spaceId: docPages.spaceId,
        title: docPages.publishedTitle,
        description: docPages.publishedDescription,
        html: docPages.publishedHtml,
        toc: docPages.publishedToc,
        markdown: docPages.publishedMarkdown,
        revisionNo: docPages.revisionNo,
        publishedAt: docPages.publishedAt,
      })
      .from(docPages)
      .where(
        and(
          eq(docPages.organizationId, organizationId),
          eq(docPages.id, pageId),
          isNotNull(docPages.publishedAt),
        ),
      )
      .limit(1);
    if (!row?.publishedAt || row.title === null || row.html === null) return null;
    return {
      id: row.id,
      spaceId: row.spaceId,
      title: row.title,
      description: row.description,
      html: row.html,
      toc: row.toc ?? [],
      markdown: row.markdown ?? "",
      revisionNo: row.revisionNo,
      publishedAt: row.publishedAt,
    };
  }

  public async create(organizationId: OrganizationId, page: NewDocPage): Promise<void> {
    await this.db.insert(docPages).values({
      id: page.id,
      organizationId,
      spaceId: page.spaceId,
      parentId: page.parentId,
      kind: page.kind,
      slug: page.slug,
      title: page.title,
      icon: page.icon,
      url: page.url,
      position: page.position,
      updatedBy: page.createdBy,
      createdBy: page.createdBy,
    });
  }

  public async saveDraft(
    organizationId: OrganizationId,
    pageId: DocPageId,
    expectedVersion: number,
    fields: DocDraftFields,
    updatedBy: UserId,
  ): Promise<boolean> {
    const saved = await this.db
      .update(docPages)
      .set({
        slug: fields.slug,
        title: fields.title,
        description: fields.description,
        icon: fields.icon,
        markdown: fields.markdown,
        url: fields.url,
        access: fields.access,
        draftVersion: sql`${docPages.draftVersion} + 1`,
        updatedBy,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(docPages.organizationId, organizationId),
          eq(docPages.id, pageId),
          eq(docPages.draftVersion, expectedVersion),
        ),
      )
      .returning({ id: docPages.id });
    return saved.length > 0;
  }

  public async publish(
    organizationId: OrganizationId,
    pageId: DocPageId,
    expectedVersion: number,
    publication: DocPublication,
    publishedBy: UserId,
  ): Promise<number | null> {
    const [row] = await this.db
      .update(docPages)
      .set({
        publishedTitle: publication.title,
        publishedDescription: publication.description,
        publishedMarkdown: publication.markdown,
        publishedHtml: publication.html,
        publishedToc: publication.toc,
        publishedDraftVersion: sql`${docPages.draftVersion}`,
        publishedBy,
        publishedAt: new Date(),
        revisionNo: sql`${docPages.revisionNo} + 1`,
        rendererVersion: publication.rendererVersion,
      })
      .where(
        and(
          eq(docPages.organizationId, organizationId),
          eq(docPages.id, pageId),
          eq(docPages.draftVersion, expectedVersion),
        ),
      )
      .returning({ revisionNo: docPages.revisionNo });
    return row?.revisionNo ?? null;
  }

  public async saveRevision(
    organizationId: OrganizationId,
    spaceId: DocSpaceId,
    pageId: DocPageId,
    revisionNo: number,
    publication: DocPublication,
    createdBy: UserId,
  ): Promise<void> {
    await this.db.insert(docRevision).values({
      id: Uuid.v7(),
      organizationId,
      spaceId,
      pageId,
      revisionNo,
      title: publication.title,
      description: publication.description,
      markdown: publication.markdown,
      createdBy,
    });
  }

  // Two statements whatever the page's length: the delete, then one multi-row insert.
  public async listStale(
    organizationId: OrganizationId,
    version: number,
    limit: number,
  ): Promise<readonly DocStalePageRecord[]> {
    const rows = await this.db
      .select({
        id: docPages.id,
        spaceId: docPages.spaceId,
        title: docPages.publishedTitle,
        description: docPages.publishedDescription,
        markdown: docPages.publishedMarkdown,
        revisionNo: docPages.revisionNo,
      })
      .from(docPages)
      .where(
        and(
          eq(docPages.organizationId, organizationId),
          isNotNull(docPages.publishedAt),
          or(isNull(docPages.rendererVersion), lt(docPages.rendererVersion, version)),
        ),
      )
      .orderBy(docPages.id)
      .limit(limit);
    return rows.map((row) => ({
      ...row,
      title: row.title ?? "",
      markdown: row.markdown ?? "",
    }));
  }

  public async saveRendering(
    organizationId: OrganizationId,
    pageId: DocPageId,
    rendering: DocRendering,
  ): Promise<void> {
    await this.db
      .update(docPages)
      .set({
        publishedHtml: rendering.html,
        publishedToc: rendering.toc,
        rendererVersion: rendering.rendererVersion,
      })
      .where(and(eq(docPages.organizationId, organizationId), eq(docPages.id, pageId)));
  }

  public async saveSections(
    organizationId: OrganizationId,
    spaceId: DocSpaceId,
    pageId: DocPageId,
    sections: readonly RenderedSection[],
  ): Promise<void> {
    await this.db
      .delete(docSections)
      .where(and(eq(docSections.organizationId, organizationId), eq(docSections.pageId, pageId)));
    if (sections.length === 0) return;

    await this.db.insert(docSections).values(
      sections.map((section, position) => ({
        id: Uuid.v7(),
        organizationId,
        spaceId,
        pageId,
        position,
        anchor: section.anchor,
        heading: section.heading,
        body: section.body,
      })),
    );
  }

  // One statement, two halves: full text over the sections, and published titles by
  // trigram, which is what finds "instal" and "quik start". Both use their own GIN index.
  // ──
  // Plain-text excerpts: empty highlight markers, because the text is an author's and
  // nothing downstream should ever be asked to render it as HTML.
  public async search(
    organizationId: OrganizationId,
    query: string,
    limit: number,
  ): Promise<readonly DocSearchMatch[]> {
    // Nothing searchable left once punctuation is gone: a lone symbol, say. Asking Postgres
    // for an empty tsquery only earns a notice.
    if (PgDocPageRepository.prefixQuery(query).length === 0) return [];
    const result = await (await this.reader()).execute<{
      page_id: DocPageId;
      space_id: DocSpaceId;
      anchor: string | null;
      heading: string | null;
      excerpt: string | null;
      rank: number;
    }>(sql`
      with q as (select to_tsquery('simple', ${PgDocPageRepository.prefixQuery(query)}) as tsq)
      (
        select s.page_id, s.space_id, s.anchor, s.heading,
          ts_headline('simple', s.body, q.tsq,
            'StartSel="", StopSel="", MaxWords=24, MinWords=8, MaxFragments=1') as excerpt,
          ts_rank(s.search, q.tsq)::float8 as rank
        from ${docSections} s, q
        where s.organization_id = ${organizationId} and s.search @@ q.tsq
        order by rank desc
        limit ${limit}
      )
      union all
      (
        select p.id, p.space_id, null, p.published_title,
          coalesce(p.published_description, ''),
          word_similarity(${query}, p.published_title)::float8 as rank
        from ${docPages} p
        where p.organization_id = ${organizationId}
          and p.published_at is not null
          and ${query} <% p.published_title
        order by rank desc
        limit ${limit}
      )
      order by rank desc
    `);

    return result.rows.map((row) => ({
      pageId: row.page_id,
      spaceId: row.space_id,
      anchor: row.anchor,
      heading: row.heading,
      excerpt: row.excerpt ?? "",
      rank: Number(row.rank),
    }));
  }

  public async listRevisions(
    organizationId: OrganizationId,
    pageId: DocPageId,
  ): Promise<readonly DocRevisionSummaryRecord[]> {
    return this.db
      .select({
        revisionNo: docRevision.revisionNo,
        title: docRevision.title,
        createdBy: docRevision.createdBy,
        createdAt: docRevision.createdAt,
      })
      .from(docRevision)
      .where(and(eq(docRevision.organizationId, organizationId), eq(docRevision.pageId, pageId)))
      .orderBy(desc(docRevision.revisionNo))
      .limit(REVISION_PAGE);
  }

  public async findRevision(
    organizationId: OrganizationId,
    pageId: DocPageId,
    revisionNo: number,
  ): Promise<DocRevisionRecord | null> {
    const [row] = await this.db
      .select({
        revisionNo: docRevision.revisionNo,
        title: docRevision.title,
        description: docRevision.description,
        markdown: docRevision.markdown,
        createdBy: docRevision.createdBy,
        createdAt: docRevision.createdAt,
      })
      .from(docRevision)
      .where(
        and(
          eq(docRevision.organizationId, organizationId),
          eq(docRevision.pageId, pageId),
          eq(docRevision.revisionNo, revisionNo),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  // One statement for the whole sibling list, numbered by its order in the array.
  public async saveOrder(
    organizationId: OrganizationId,
    parentId: DocPageId | null,
    orderedIds: readonly DocPageId[],
  ): Promise<void> {
    if (orderedIds.length === 0) return;
    const ids = sql.join(
      orderedIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    await this.db.execute(sql`
      update ${docPages}
      set parent_id = ${parentId}::uuid, position = ordered.ordinality - 1
      from unnest(array[${ids}]) with ordinality as ordered(id, ordinality)
      where ${docPages.organizationId} = ${organizationId} and ${docPages.id} = ordered.id
    `);
  }

  public async delete(
    organizationId: OrganizationId,
    pageIds: readonly DocPageId[],
  ): Promise<void> {
    if (pageIds.length === 0) return;
    const ids = [...pageIds];
    await this.db
      .delete(docSections)
      .where(and(eq(docSections.organizationId, organizationId), inArray(docSections.pageId, ids)));
    await this.db
      .delete(docRevision)
      .where(and(eq(docRevision.organizationId, organizationId), inArray(docRevision.pageId, ids)));
    await this.db
      .delete(docPages)
      .where(and(eq(docPages.organizationId, organizationId), inArray(docPages.id, ids)));
  }

  public async deleteBySpace(organizationId: OrganizationId, spaceId: DocSpaceId): Promise<void> {
    await this.db
      .delete(docSections)
      .where(and(eq(docSections.organizationId, organizationId), eq(docSections.spaceId, spaceId)));
    await this.db
      .delete(docRevision)
      .where(and(eq(docRevision.organizationId, organizationId), eq(docRevision.spaceId, spaceId)));
    await this.db
      .delete(docPages)
      .where(and(eq(docPages.organizationId, organizationId), eq(docPages.spaceId, spaceId)));
  }

  // Every word a prefix, so "instal" finds "installation". Only letters and digits survive,
  // so the string is always valid tsquery and never carries an operator of its own.
  private static prefixQuery(query: string): string {
    return (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .slice(0, 8)
      .map((word) => `${word}:*`)
      .join(" & ");
  }

  // The column is text; `DocRules` and the contract are what keep it one of the three.
  private static node<T extends { readonly kind: string }>(
    row: T,
  ): Omit<T, "kind"> & { readonly kind: DocPageKind } {
    return { ...row, kind: row.kind as DocPageKind };
  }
}
