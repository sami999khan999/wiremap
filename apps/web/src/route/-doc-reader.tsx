import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import {
  buttonClassName,
  DocReaderPanel,
  type DocReadingDto,
  type DocSearchHit,
  type DocSpaceDto,
  type ModeKey,
  type ReactNode,
  type ThemeKey,
  ThemeRegistry,
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
    // The palette's selectors are not anchored to <html>, so these two attributes rescope
    // all twelve colours for everything inside.
    <div data-theme={theme} data-mode={mode} style={{ colorScheme: mode }}>
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
          <Link to={back.href} className={buttonClassName("ghost")}>
            {back.label}
          </Link>
        }
        editHref={editHref}
        markdownHref={markdownHref}
        {...(search ? { search } : {})}
      />
    </div>
  );
}
