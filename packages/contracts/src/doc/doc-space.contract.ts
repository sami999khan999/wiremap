import { z } from "../import.js";
import { Identifiers } from "../primitive/index.js";
import { DocNav } from "./doc-nav.js";

// Who may read a space. `public` and `granted` are the platform organization's alone, and
// `owner` is its author's only — see packages/application/docs/reference/doc.md.
const audience = z.enum(["members", "public", "granted", "owner"]);

// Lower-case words joined by single hyphens. It is a URL segment, so nothing a browser
// would encode is allowed in.
const slug = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 300;

const entity = z.object({
  id: Identifiers.docSpaceId,
  slug,
  title: z.string(),
  description: z.string().nullable(),
  // An icon name from `@loadbearing/asset`. A string here, because contracts sits left of
  // the sprite, and an unknown name renders as no icon rather than failing to parse.
  icon: z.string().nullable(),
  audience,
  // The theme the space opens in when the reader has chosen none of their own.
  theme: z.string().nullable(),
  position: z.number().int().nonnegative(),
  // Who created it, which is who an `owner` space belongs to.
  createdBy: Identifiers.userId,
  // Bumped on every publish, move and delete: the cache key for the published tree.
  version: z.number().int().nonnegative(),
  updatedAt: z.date(),
});

const create = z.object({
  slug,
  title: z.string().trim().min(1).max(TITLE_MAX),
  description: z.string().trim().max(DESCRIPTION_MAX).nullable().default(null),
  icon: z.string().max(40).nullable().default(null),
  audience: audience.default("members"),
  theme: z.string().max(40).nullable().default(null),
});

export class DocSpaceContract {
  private constructor() {}

  public static readonly audience = audience;
  public static readonly slug = slug;
  public static readonly entity = entity;

  // The space and its published tree, which is what a reader's sidebar is drawn from.
  public static readonly view = entity.extend({ nav: z.array(DocNav.node).readonly() });

  public static readonly list = z.object({ items: z.array(entity).readonly() });

  // A space's whole published tree, asked for by slug. `version` is the space's, so a
  // reader can cache the answer until the next publish, move or delete.
  public static readonly navQuery = z.object({ slug });
  public static readonly nav = z.object({
    version: z.number().int().nonnegative(),
    nav: z.array(DocNav.node).readonly(),
  });

  public static readonly get = z.object({ spaceId: Identifiers.docSpaceId });

  public static readonly create = create;

  public static readonly update = create.extend({
    spaceId: Identifiers.docSpaceId,
    position: z.number().int().nonnegative(),
  });
}

export type DocSpaceAudience = z.infer<typeof audience>;
export type DocSpaceDto = z.infer<typeof DocSpaceContract.entity>;
export type DocSpaceViewDto = z.infer<typeof DocSpaceContract.view>;
export type DocSpaceListDto = z.infer<typeof DocSpaceContract.list>;
export type DocSpaceRefInput = z.infer<typeof DocSpaceContract.get>;
export type DocSpaceNavInput = z.infer<typeof DocSpaceContract.navQuery>;
export type DocSpaceNavDto = z.infer<typeof DocSpaceContract.nav>;
export type CreateDocSpaceInput = z.infer<typeof DocSpaceContract.create>;
export type UpdateDocSpaceInput = z.infer<typeof DocSpaceContract.update>;
