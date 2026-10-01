import { cn } from "../../class-name/index.js";
import { Icon } from "../icon/index.js";

export interface SearchTriggerProps {
  readonly label: string;
  // Space-separated keys, each drawn as its own cap: "Ctrl K".
  readonly shortcut?: string;
  readonly onClick: () => void;
  readonly className?: string;
}

// Looks like a field and is a button: typing happens in the palette it opens, so a real
// input here would hold a query nobody could submit.
export function SearchTrigger({ label, shortcut, onClick, className }: SearchTriggerProps) {
  return (
    <button
      type="button"
      className={cn(
        "ui-search-trigger flex h-(--control-height) w-full cursor-pointer items-center gap-2 rounded-md border border-border bg-muted pr-2 pl-3 text-left text-fg-muted text-sm [font:inherit] transition-colors duration-(--duration-fast) hover:border-[color-mix(in_oklch,var(--border)_70%,var(--fg))]",
        className,
      )}
      onClick={onClick}
    >
      <Icon name="search" size={16} />
      <span className="ui-search-trigger__label flex-1">{label}</span>
      {shortcut ? (
        <span className="ui-search-trigger__keys inline-flex gap-1" aria-hidden="true">
          {shortcut.split(" ").map((key) => (
            <kbd
              key={key}
              className="ui-kbd inline-flex h-5 min-w-5 items-center rounded-sm border border-border bg-surface px-1 font-mono text-fg-muted text-xs leading-none"
            >
              {key}
            </kbd>
          ))}
        </span>
      ) : null}
    </button>
  );
}
