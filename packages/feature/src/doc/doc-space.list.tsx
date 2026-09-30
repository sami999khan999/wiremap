import { useMessages } from "../i18n/index.js";
import { Card, CardGrid, type DocSpaceDto, EmptyState } from "../import.js";
import { DocNavTree } from "./doc-nav-tree.js";
import type { RenderDocLink } from "./doc-search.panel.js";

export interface DocSpaceListProps {
  readonly spaces: readonly DocSpaceDto[];
  // `/doc` or `/docs`: each card opens `<root>/<slug>`.
  readonly root: string;
  readonly renderLink: RenderDocLink;
}

// Where a reader lands before choosing a space: one card per space, as the reference
// design's card grid, in the order the spaces were arranged.
export function DocSpaceList({ spaces, root, renderLink }: DocSpaceListProps) {
  const { t } = useMessages("doc");

  if (spaces.length === 0) return <EmptyState icon="book" title={t("doc.home.empty")} />;

  return (
    <CardGrid>
      {spaces.map((space) => (
        <Card
          key={space.id}
          title={space.title}
          icon={DocNavTree.icon(space.icon) ?? "book"}
          href={`${root}/${space.slug}`}
          renderLink={renderLink}
          {...(space.description ? { description: space.description } : {})}
        />
      ))}
    </CardGrid>
  );
}
