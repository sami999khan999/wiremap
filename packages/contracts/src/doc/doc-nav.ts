import { z } from "../import.js";
import { type DocPageId, Identifiers } from "../primitive/index.js";
import { DocAccessContract, type DocAccessRuleDto } from "./doc-access.contract.js";

// A `section` is a heading in the sidebar with no page behind it, a `page` is Markdown,
// and a `link` points somewhere else. All three are rows in one tree.
const kind = z.enum(["section", "page", "link"]);

export type DocPageKind = z.infer<typeof kind>;

// Declared by hand because the node holds itself: zod cannot infer a recursive type.
export interface DocNavNodeDto {
  readonly id: DocPageId;
  readonly kind: DocPageKind;
  readonly title: string;
  readonly icon: string | null;
  // The page's path under its space, `guides/writing`. Null for a section, which adds no
  // segment, and for a link, which leaves the space.
  readonly path: string | null;
  readonly url: string | null;
  // The published revision, so a reader resolves the page's cache key from the tree alone.
  readonly revisionNo: number | null;
  readonly children: readonly DocNavNodeDto[];
  // True when `children` was left out of a page read to keep it small. The full tree comes
  // from `docSpace.nav`, once per space version.
  readonly folded?: boolean;
  // The page's own access rule, present only when it has one, so a reader's tree can be
  // filtered without reading a row per page.
  readonly access?: DocAccessRuleDto;
}

const node: z.ZodType<DocNavNodeDto> = z.lazy(() =>
  z.object({
    id: Identifiers.docPageId,
    kind,
    title: z.string(),
    icon: z.string().nullable(),
    path: z.string().nullable(),
    url: z.string().nullable(),
    revisionNo: z.number().int().positive().nullable(),
    children: z.array(node).readonly(),
    folded: z.boolean().optional(),
    access: DocAccessContract.rule.optional(),
  }),
);

// The published tree of one space. Its own file because both the space and the page
// contracts carry it, and neither should import the other for it.
export class DocNav {
  private constructor() {}

  public static readonly kind = kind;
  public static readonly node = node;
}
