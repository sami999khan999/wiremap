import type { ReactNode } from "../import.js";

export interface ZoneItem {
  // React's key, and nothing else: the zone never reads it, so any stable id will do.
  readonly key: string;
  readonly title: string;
  readonly content: ReactNode;
  readonly action?: ReactNode;
}

export interface ZoneProps {
  // Names the region for a screen reader. A zone has no visible heading of its own.
  readonly label: string;
  readonly items: readonly ZoneItem[];
  readonly empty?: ReactNode;
}

// A place a page puts units side by side, and nothing more: no registry, no session, no
// permission. `items`, not children, so nothing can be dropped in beside the units unwrapped.
export function Zone({ label, items, empty }: ZoneProps) {
  if (items.length === 0) {
    return empty ? (
      <section className="ui-zone ui-zone--empty" aria-label={label}>
        {empty}
      </section>
    ) : null;
  }

  return (
    <section className="ui-zone" aria-label={label}>
      {items.map((item) => (
        <article key={item.key} className="ui-zone__item">
          <header className="ui-zone__header">
            <h2 className="ui-zone__title">{item.title}</h2>
            {item.action ? <div className="ui-zone__action">{item.action}</div> : null}
          </header>
          {item.content}
        </article>
      ))}
    </section>
  );
}
