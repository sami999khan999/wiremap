import { cn } from "../../class-name/index.js";

export interface CodeListProps {
  readonly values: readonly string[];
  // Labels the list for a screen reader. Required for the same reason `Field` requires
  // `htmlFor`: a bare list of ten opaque strings is unusable without one.
  readonly label: string;
  readonly className?: string;
}

// A grid of short opaque strings — backup codes, and nothing else so far. Monospace and
// selectable, because the only useful thing to do with these is copy them somewhere safe.
export function CodeList({ values, label, className }: CodeListProps) {
  return (
    <ul
      className={cn(
        "ui-code-list m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2 p-0",
        className,
      )}
      aria-label={label}
    >
      {values.map((value) => (
        // The value is the identity: these are unique by construction, and a code that
        // moved position in the list would be a different code.
        <li
          className="ui-code-list__item whitespace-nowrap rounded-sm border border-border bg-muted p-2 text-center font-mono text-fg text-sm"
          key={value}
        >
          <code>{value}</code>
        </li>
      ))}
    </ul>
  );
}
