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
      className={["ui-search-trigger", className].filter(Boolean).join(" ")}
      onClick={onClick}
    >
      <Icon name="search" size={16} />
      <span className="ui-search-trigger__label">{label}</span>
      {shortcut ? (
        <span className="ui-search-trigger__keys" aria-hidden="true">
          {shortcut.split(" ").map((key) => (
            <kbd key={key} className="ui-kbd">
              {key}
            </kbd>
          ))}
        </span>
      ) : null}
    </button>
  );
}
