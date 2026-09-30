import { cn } from "../class-name/index.js";
import type { ReactNode } from "../import.js";

export interface ReaderLayoutProps {
  // A `Sidebar`, normally. Passed whole so the caller decides what it holds.
  readonly sidebar: ReactNode;
  // Below the sidebar's breakpoint, the bar that opens it. Hidden on a wide screen, where
  // the sidebar is already in the layout.
  readonly topbar?: ReactNode;
  // "On this page". Dropped below the width at which three columns stop fitting.
  readonly aside?: ReactNode;
  readonly header?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

// The article is capped at a readable measure and the outline at a fixed width, so a wide
// screen adds margin rather than line length. Exported for pages that lay out the same way.
export const readerClassName = Object.freeze({
  content:
    "ui-reader__content grid grid-cols-[minmax(0,48rem)] justify-center gap-12 px-8 pt-10 pb-16 max-lg:px-4 max-lg:pt-6 max-lg:pb-12",
  contentAside:
    "ui-reader__content--aside grid-cols-[minmax(0,48rem)_14rem] max-xl:grid-cols-[minmax(0,48rem)]",
  // Sticky under the viewport's top edge, and scrolls on its own when taller than the screen.
  aside:
    "ui-reader__aside sticky top-8 max-h-[calc(100dvh-4rem)] self-start overflow-y-auto max-xl:hidden",
  header: "ui-reader__header mb-8 flex flex-col gap-3 border-border border-b pb-6",
  title: "ui-reader__title m-0 font-semibold text-2xl leading-tight",
  description: "ui-reader__description m-0 text-fg-muted text-lg",
  actions: "ui-reader__actions mt-2 flex flex-wrap gap-2",
});

// Three columns — navigation, the article, its outline — and one on a phone. Knows nothing
// about docs: anything read top to bottom with a table of contents fits.
export function ReaderLayout({
  sidebar,
  topbar,
  aside,
  header,
  children,
  className,
}: ReaderLayoutProps) {
  return (
    <div className={cn("ui-reader flex min-h-dvh bg-bg text-fg", className)}>
      {sidebar}
      <div className="ui-reader__main min-w-0 flex-1">
        {topbar ? (
          <div className="ui-reader__topbar hidden max-lg:sticky max-lg:top-0 max-lg:z-30 max-lg:flex max-lg:items-center max-lg:gap-3 max-lg:border-border max-lg:border-b max-lg:bg-bg max-lg:px-4 max-lg:py-2">
            {topbar}
          </div>
        ) : null}
        <div className={cn(readerClassName.content, aside && readerClassName.contentAside)}>
          <article className="ui-reader__article min-w-0">
            {header ? <header className={readerClassName.header}>{header}</header> : null}
            {children}
          </article>
          {aside ? <div className={readerClassName.aside}>{aside}</div> : null}
        </div>
      </div>
    </div>
  );
}
