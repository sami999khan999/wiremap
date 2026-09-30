import type { DocGrantKind, DocSpaceId, OrganizationId, UserId } from "../import.js";

export interface DocGrantRecord {
  readonly id: string;
  readonly spaceId: DocSpaceId;
  readonly kind: DocGrantKind;
  readonly label: string;
  readonly reason: string;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
}

// What a typed target resolved to: the key the row stores, and the name an operator reads.
export interface DocGrantee {
  readonly kind: DocGrantKind;
  readonly key: string;
  readonly label: string;
}

export interface NewDocGrant {
  readonly id: string;
  readonly spaceId: DocSpaceId;
  readonly grantee: DocGrantee;
  readonly reason: string;
  readonly expiresAt: Date | null;
  readonly createdBy: UserId;
}

// Catalog: grants point across tenants and are read before a request is placed. No
// tenant argument, because a grant belongs to the platform and names the tenant it opens to.
export abstract class DocGrantRepository {
  public abstract list(spaceId: DocSpaceId): Promise<readonly DocGrantRecord[]>;

  // An organization by id or slug, a person by email, a plan by key. Null is "nothing
  // answers to that", which is an ordinary answer to something an operator typed.
  public abstract findGrantee(kind: DocGrantKind, target: string): Promise<DocGrantee | null>;

  // One per space and grantee: an existing row takes the new reason and expiry.
  public abstract save(grant: NewDocGrant): Promise<DocGrantRecord>;

  // The space the grant was on, or null when there was none to delete.
  public abstract delete(grantId: string): Promise<DocSpaceId | null>;

  public abstract deleteBySpace(spaceId: DocSpaceId): Promise<void>;

  // Every space open to this person through any route: their own grant, their active
  // organization's, or that organization's plan's. Expired grants are already excluded.
  public abstract readableSpaceIds(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<readonly DocSpaceId[]>;
}
