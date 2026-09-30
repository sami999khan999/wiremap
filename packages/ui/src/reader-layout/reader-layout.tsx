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
    <div className={["ui-reader", className].filter(Boolean).join(" ")}>
      {sidebar}
      <div className="ui-reader__main">
        {topbar ? <div className="ui-reader__topbar">{topbar}</div> : null}
        <div
          className={aside ? "ui-reader__content ui-reader__content--aside" : "ui-reader__content"}
        >
          <article className="ui-reader__article">
            {header ? <header className="ui-reader__header">{header}</header> : null}
            {children}
          </article>
          {aside ? <div className="ui-reader__aside">{aside}</div> : null}
        </div>
      </div>
    </div>
  );
}
