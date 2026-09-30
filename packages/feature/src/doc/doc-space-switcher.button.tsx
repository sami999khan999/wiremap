import { useMessages } from "../i18n/index.js";
import { type DocSpaceDto, Menu, type MenuOption, useMemo } from "../import.js";
import { DocNavTree } from "./doc-nav-tree.js";

export interface DocSpaceSwitcherButtonProps {
  readonly spaces: readonly DocSpaceDto[];
  readonly current: string;
  // The space's slug. The shell turns it into a route, since this package has no router.
  readonly onSelect: (slug: string) => void;
}

// The "Framework" switcher of the reference design: one space among the ones this reader
// may open. Hidden when there is only one, since a menu of one choice is a label.
export function DocSpaceSwitcherButton({ spaces, current, onSelect }: DocSpaceSwitcherButtonProps) {
  const { t } = useMessages("doc");

  const options = useMemo(
    () =>
      spaces.map((space): MenuOption => {
        const icon = DocNavTree.icon(space.icon ?? "book") ?? "book";
        return {
          value: space.slug,
          label: space.title,
          icon,
          ...(space.description ? { description: space.description } : {}),
        };
      }),
    [spaces],
  );

  if (options.length < 2) return null;
  return (
    <Menu label={t("doc.switcher.label")} value={current} options={options} onSelect={onSelect} />
  );
}
