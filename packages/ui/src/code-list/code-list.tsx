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
    <ul className={["ui-code-list", className].filter(Boolean).join(" ")} aria-label={label}>
      {values.map((value) => (
        // The value is the identity: these are unique by construction, and a code that
        // moved position in the list would be a different code.
        <li className="ui-code-list__item" key={value}>
          <code>{value}</code>
        </li>
      ))}
    </ul>
  );
}
