import type {
  DocNavNodeDto,
  DocSpaceAudience,
  DocSpaceId,
  OrganizationId,
  UserId,
} from "../import.js";

export interface DocSpaceFields {
  readonly slug: string;
  readonly title: string;
  readonly description: string | null;
  readonly icon: string | null;
  readonly audience: DocSpaceAudience;
  readonly theme: string | null;
}

export interface DocSpaceSummary extends DocSpaceFields {
  readonly id: DocSpaceId;
  readonly organizationId: OrganizationId;
  // The author, and so the only reader of an `owner` space.
  readonly createdBy: UserId;
  readonly position: number;
  readonly version: number;
  readonly updatedAt: Date;
}

// With the published tree, which is the whole of a sidebar. A list never carries it.
export interface DocSpaceRecord extends DocSpaceSummary {
  readonly nav: readonly DocNavNodeDto[];
}

// Every method takes the tenant first — the platform's own spaces are simply the
// platform organization's, so there is no second shape for them.
export abstract class DocSpaceRepository {
  public abstract list(organizationId: OrganizationId): Promise<readonly DocSpaceSummary[]>;

  public abstract findById(
    organizationId: OrganizationId,
    spaceId: DocSpaceId,
  ): Promise<DocSpaceRecord | null>;

  public abstract findBySlug(
    organizationId: OrganizationId,
    slug: string,
  ): Promise<DocSpaceRecord | null>;

  // False when the slug is taken: the unique index decides, so two creates racing for
  // one slug cannot both win.
  public abstract create(
    organizationId: OrganizationId,
    spaceId: DocSpaceId,
    fields: DocSpaceFields,
    createdBy: UserId,
  ): Promise<boolean>;

  // False when another space already has the slug.
  public abstract save(
    organizationId: OrganizationId,
    spaceId: DocSpaceId,
    fields: DocSpaceFields,
    position: number,
  ): Promise<boolean>;

  // Replaces the published tree and bumps the version, which is what retires every
  // cached copy of the old one. Returns the new version.
  public abstract saveNav(
    organizationId: OrganizationId,
    spaceId: DocSpaceId,
    nav: readonly DocNavNodeDto[],
  ): Promise<number>;

  public abstract delete(organizationId: OrganizationId, spaceId: DocSpaceId): Promise<void>;
}
