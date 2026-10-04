import { cn } from "../../class-name/index.js";
import type { ReactNode } from "../../import.js";

export type PageWidth = "wide" | "narrow" | "embedded";

export interface PageProps {
  readonly width?: PageWidth;
  readonly className?: string;
  readonly children: ReactNode;
}

const WIDTH: Readonly<Record<PageWidth, string>> = Object.freeze({
  wide: "",
  narrow: "ui-page--narrow",
  embedded: "ui-page--embedded",
});

// The body of every screen under the app's layout. The layout owns the `<main>`, so this is
// a `<div>`: two mains on one page is an invalid landmark tree.
export function Page({ width = "wide", className, children }: PageProps) {
  return <div className={cn("ui-page", WIDTH[width], className)}>{children}</div>;
}
