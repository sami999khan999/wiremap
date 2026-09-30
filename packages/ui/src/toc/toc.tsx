import { cn } from "../class-name/index.js";
import { Icon } from "../icon/index.js";
import { useEffect, useState } from "../import.js";

export interface TocItem {
  // The heading's `id` in the page, which is what the link and the observer both find.
  readonly id: string;
  readonly text: string;
  // 2 for an `h2`, 3 for an `h3`. Indentation is relative to the shallowest item.
  readonly depth: number;
}

export interface TocProps {
  readonly title: string;
  readonly items: readonly TocItem[];
  readonly className?: string;
}

// The heading counts as current once it reaches the top quarter of the viewport, which
// is where a reader's eye is rather than where the heading first appears.
const ROOT_MARGIN = "0px 0px -75% 0px";

// Indentation by relative depth; the rail is the list's left border, which the link overlaps.
const INDENT: readonly string[] = Object.freeze(["", "pl-6", "pl-8"]);

// "On this page", with the current section marked as the reader scrolls. One observer for
// every heading; a scroll listener would measure each of them on every frame.
export function Toc({ title, items, className }: TocProps) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    setActive(items[0]?.id ?? null);
    if (typeof IntersectionObserver === "undefined" || items.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // Document order, not arrival order: two headings entering together pick the first.
        const first = items.find((item) => visible.has(item.id));
        if (first) setActive(first.id);
      },
      { rootMargin: ROOT_MARGIN },
    );

    for (const item of items) {
      const heading = document.getElementById(item.id);
      if (heading) observer.observe(heading);
    }
    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0) return null;
  const shallowest = Math.min(...items.map((item) => item.depth));

  return (
    <nav aria-label={title} className={cn("ui-toc text-sm", className)}>
      <p className="ui-toc__title m-0 mb-3 flex items-center gap-2 text-fg-muted">
        <Icon name="menu" size={14} />
        {title}
      </p>
      <ul className="ui-toc__list m-0 list-none border-border border-l p-0">
        {items.map((item) => (
          <li key={item.id} className="ui-toc__item" data-depth={item.depth - shallowest}>
            <a
              href={`#${item.id}`}
              // --primary on --bg for the current heading, a pairing check-contrast.mjs asserts.
              className={cn(
                "ui-toc__link -ml-px block border-transparent border-l px-3 py-1 text-fg-muted leading-tight no-underline transition-colors duration-(--duration-fast) hover:text-fg",
                INDENT[item.depth - shallowest],
                item.id === active &&
                  "ui-toc__link--active border-l-primary text-primary hover:text-primary",
              )}
              aria-current={item.id === active ? "location" : undefined}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
