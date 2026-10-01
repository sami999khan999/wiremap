import {
  customType,
  type DocAccessRuleDto,
  type DocNavNodeDto,
  type DocPageId,
  type DocSpaceId,
  type DocTocEntryDto,
  index,
  integer,
  jsonb,
  type OrganizationId,
  pgTable,
  primaryKey,
  sql,
  text,
  timestamp,
  type UserId,
  uniqueIndex,
  uuid,
} from "../../import.js";

// Written by Postgres from the section's own text and never by the application, which is
// why the adapter only ever reads it.
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

// Tenant level only: a space grows with the organization, not with the calendar. The
// platform's own public and granted spaces are rows here too, under its organization.
export const docSpaces = pgTable(
  "doc_spaces",
  {
    id: uuid("id").$type<DocSpaceId>().notNull(),
    // Routed, so no key to `organizations` — decision `24.1`.
    organizationId: uuid("organization_id").$type<OrganizationId>().notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    icon: text("icon"),
    audience: text("audience").notNull().default("members"),
    theme: text("theme"),
    // The access rule every page in the space inherits; null is none. See doc.md.
    access: jsonb("access").$type<DocAccessRuleDto>(),
    // A repository the reader's sidebar links to; null shows no link.
    repositoryUrl: text("repository_url"),
    position: integer("position").notNull().default(0),
    // The published tree, rebuilt in the transaction that changes it: a reader's sidebar
    // is this column and nothing else. See application/docs/reference/doc.md.
    nav: jsonb("nav").$type<readonly DocNavNodeDto[]>().notNull().default([]),
    version: integer("version").notNull().default(0),
    createdBy: uuid("created_by").$type<UserId>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.organizationId] }),
    uniqueIndex("doc_spaces_slug_uq").on(t.organizationId, t.slug),
    // An author's own `owner` spaces, the one lookup that audience adds. Partial, because
    // every other audience is found by organization alone.
    index("doc_spaces_owner_idx").on(t.organizationId, t.createdBy).where(sql`audience = 'owner'`),
  ],
);

// The draft and the published snapshot share a row, so a read is one row and the history
// in `doc_revision` can be archived without touching a live page. Never `select *`.
export const docPages = pgTable(
  "doc_pages",
  {
    id: uuid("id").$type<DocPageId>().notNull(),
    organizationId: uuid("organization_id").$type<OrganizationId>().notNull(),
    // No key to `doc_spaces` or to itself since `PF.1`: both are tenant-partitioned.
    spaceId: uuid("space_id").$type<DocSpaceId>().notNull(),
    parentId: uuid("parent_id").$type<DocPageId>(),
    kind: text("kind").notNull(),
    slug: text("slug").notNull(),
    position: integer("position").notNull().default(0),
    icon: text("icon"),
    url: text("url"),
    // Added to the space's rule, never instead of it. Live on save, like a slug.
    access: jsonb("access").$type<DocAccessRuleDto>(),
    title: text("title").notNull(),
    description: text("description"),
    markdown: text("markdown").notNull().default(""),
    // The optimistic lock. Every save and publish names the one it read.
    draftVersion: integer("draft_version").notNull().default(1),
    updatedBy: uuid("updated_by").$type<UserId>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    publishedTitle: text("published_title"),
    publishedDescription: text("published_description"),
    publishedMarkdown: text("published_markdown"),
    publishedHtml: text("published_html"),
    publishedToc: jsonb("published_toc").$type<readonly DocTocEntryDto[]>(),
    // The draft version this snapshot was taken from. Equal to `draft_version` is
    // published and current; less is published with a newer draft behind it.
    publishedDraftVersion: integer("published_draft_version"),
    publishedBy: uuid("published_by").$type<UserId>(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // A counter, not a count of `doc_revision` rows: a unique index there cannot lead
    // with the page once the table has a month level.
    revisionNo: integer("revision_no").notNull().default(0),
    rendererVersion: integer("renderer_version"),
    createdBy: uuid("created_by").$type<UserId>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.organizationId] }),
    // Two, split on the null: NULLs are distinct, so one index over `parent_id` would
    // let two top-level pages share a slug.
    uniqueIndex("doc_pages_child_slug_uq")
      .on(t.organizationId, t.spaceId, t.parentId, t.slug)
      .where(sql`${t.parentId} is not null`),
    uniqueIndex("doc_pages_root_slug_uq")
      .on(t.organizationId, t.spaceId, t.slug)
      .where(sql`${t.parentId} is null`),
    index("doc_pages_space_idx").on(t.organizationId, t.spaceId, t.parentId, t.position),
    index("doc_pages_space_fk_idx").on(t.spaceId),
    index("doc_pages_parent_fk_idx").on(t.parentId),
    // Ctrl-K matches titles by prefix and by typo, which full-text search does neither of.
    index("doc_pages_title_trgm_idx").using("gin", sql`${t.publishedTitle} gin_trgm_ops`),
  ],
);

// Append-only, and ranged by month under the tenant: it grows with every publish. Never
// dropped by the calendar — the month level buys an archive path, not a retention policy.
export const docRevision = pgTable(
  "doc_revision",
  {
    id: uuid("id").notNull(),
    organizationId: uuid("organization_id").$type<OrganizationId>().notNull(),
    spaceId: uuid("space_id").$type<DocSpaceId>().notNull(),
    pageId: uuid("page_id").$type<DocPageId>().notNull(),
    revisionNo: integer("revision_no").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    // The source only. The HTML is derived, and a restore renders it again on publish.
    markdown: text("markdown").notNull(),
    // No key: the history outlives its author's account, as the audit trail does.
    createdBy: uuid("created_by").$type<UserId>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.organizationId, t.createdAt] }),
    index("doc_revision_page_idx").on(t.organizationId, t.pageId, t.revisionNo.desc()),
    index("doc_revision_page_fk_idx").on(t.pageId),
    index("doc_revision_space_fk_idx").on(t.spaceId),
  ],
);

// One row per heading of each published page, replaced on every publish in the same
// transaction, so a page is searchable the moment a reader can open it.
export const docSections = pgTable(
  "doc_sections",
  {
    id: uuid("id").notNull(),
    organizationId: uuid("organization_id").$type<OrganizationId>().notNull(),
    spaceId: uuid("space_id").$type<DocSpaceId>().notNull(),
    pageId: uuid("page_id").$type<DocPageId>().notNull(),
    position: integer("position").notNull(),
    // Null for the page's own title row and for text above the first heading.
    anchor: text("anchor"),
    heading: text("heading"),
    body: text("body").notNull(),
    // `simple`, not a language: the same index serves every locale an author writes in.
    search: tsvector("search").generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce(heading, '')), 'A') || setweight(to_tsvector('simple', body), 'B')`,
    ),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.organizationId] }),
    index("doc_sections_page_idx").on(t.organizationId, t.pageId, t.position),
    index("doc_sections_page_fk_idx").on(t.pageId),
    index("doc_sections_space_fk_idx").on(t.spaceId),
    index("doc_sections_search_idx").using("gin", t.search),
  ],
);
