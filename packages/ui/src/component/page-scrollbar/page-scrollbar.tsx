import { GlassScroll, type GlassScrollTheme, type ReactNode } from "../../import.js";

// Every colour is a mix of the twelve, so the bar follows the theme and the mode with no
// dark twin: the tokens already change with `data-mode`. See docs/reference/scrollbar.md.
const THEME: GlassScrollTheme = {
  thumbBg: "color-mix(in oklch, var(--fg-muted) 45%, transparent)",
  thumbBgHover: "color-mix(in oklch, var(--fg-muted) 70%, transparent)",
  thumbBgActive: "color-mix(in oklch, var(--fg) 70%, transparent)",
  thumbShadow: "inset 0 0 0 1px color-mix(in oklch, var(--bg) 30%, transparent)",
  trackBg: "transparent",
};

export interface PageScrollbarProps {
  // Restores the browser's own page scrollbar without unmounting.
  readonly disabled?: boolean;
  // The app. Wrapped so every `ScrollArea` inside shares this theme and this one stylesheet.
  readonly children?: ReactNode;
}

// Mounted once, at the root: the page gets a glass overlay bar with no layout width, and
// every inner scroller (sidebars, menus, code, tables) gets the same colours as a thin bar.
export function PageScrollbar({ disabled = false, children }: PageScrollbarProps) {
  // `themeScope`: a `ThemeScope` redefines the tokens, and the bar must follow the nearest one.
  return (
    <GlassScroll
      scope="all"
      colorScheme="light"
      themeScope="[data-theme]"
      theme={THEME}
      disabled={disabled}
    >
      {children}
    </GlassScroll>
  );
}
