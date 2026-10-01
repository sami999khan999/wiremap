import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import {
  type DocNavNodeDto,
  DocReaderPanel,
  type DocReadingDto,
  type DocSearchHit,
  type DocSpaceDto,
  Icon,
  type ModeKey,
  type ReactNode,
  type ThemeKey,
  ThemeRegistry,
  ThemeScope,
  useState,
} from "~/import.js";
import { DocLink } from "~/route/-doc-link.js";

export interface DocReaderRouteProps {
  readonly reading: DocReadingDto;
  readonly spaces: readonly DocSpaceDto[];
  readonly root: "/doc" | "/docs";
  readonly back: { readonly href: "/dashboard" | "/"; readonly label: ReactNode };
  readonly editHref?: string | null;
  readonly markdownHref?: string | null;
  readonly search?: (query: string) => Promise<readonly DocSearchHit[]>;
  readonly loadNav?: () => Promise<readonly DocNavNodeDto[]>;
}

// Shared by both trees. It owns the palette: a space may open in its own theme, the
// reader's choice beats it, and the choice is scoped to this wrapper rather than to <html>.
export function DocReaderRoute({
  reading,
  spaces,
  root,
  back,
  editHref = null,
  markdownHref = null,
  search,
  loadNav,
}: DocReaderRouteProps) {
  const navigate = useNavigate();
  const { appearance, appearanceSnapshot } = useRouteContext({ from: "__root__" });
  const [picked, setPicked] = useState<{ theme: ThemeKey; mode: ModeKey } | null>(null);

  const spaceTheme = reading.space.theme;
  const theme =
    picked?.theme ??
    (spaceTheme !== null && ThemeRegistry.isKnown(spaceTheme)
      ? spaceTheme
      : appearanceSnapshot.theme);
  const mode = picked?.mode ?? ThemeRegistry.resolveMode(theme, appearanceSnapshot.mode);

  return (
    // The reader's own theme, and the element its popovers and search palette portal into.
    <ThemeScope theme={theme} mode={mode}>
      <DocReaderPanel
        reading={reading}
        spaces={spaces}
        root={root}
        renderLink={DocLink.render}
        onSelectSpace={(space) =>
          void navigate({ to: `${root}/$space/$`, params: { space, _splat: "" } })
        }
        appearance={{
          theme,
          mode,
          onChange: (nextTheme, nextMode) => {
            appearance.choose(nextTheme, nextMode, nextMode === "dark");
            setPicked({ theme: nextTheme, mode: nextMode });
          },
        }}
        brand={
          <Link
            to={back.href}
            className="ui-doc-brand inline-flex items-center gap-1 self-start rounded-md px-2 py-1 font-semibold text-fg text-sm no-underline transition-colors duration-(--duration-fast) hover:bg-muted"
          >
            <Icon name="chevron-right" size={14} className="rotate-180 text-fg-muted" />
            {back.label}
          </Link>
        }
        editHref={editHref}
        markdownHref={markdownHref}
        {...(search ? { search } : {})}
        {...(loadNav ? { loadNav } : {})}
      />
    </ThemeScope>
  );
}
