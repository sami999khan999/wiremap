import { cn } from "../../class-name/index.js";
import { BaseMenu, type IconName, type ReactNode } from "../../import.js";
import { usePortalContainer } from "../../theme/index.js";
import { Icon } from "../icon/index.js";

export type ActionMenuEntry =
  | {
      readonly kind: "item";
      readonly key: string;
      readonly label: string;
      readonly icon?: IconName;
      // A second, muted line: the organization's slug, the account's email.
      readonly detail?: string;
      readonly onSelect: () => void;
      readonly checked?: boolean;
      readonly tone?: "default" | "danger";
      readonly disabled?: boolean;
    }
  | { readonly kind: "separator"; readonly key: string }
  | { readonly kind: "heading"; readonly key: string; readonly label: string };

export interface ActionMenuProps {
  // The trigger's accessible name.
  readonly label: string;
  // What the trigger renders: an avatar, or a logo and a name with a chevron.
  readonly trigger: ReactNode;
  readonly entries: readonly ActionMenuEntry[];
  readonly align?: "start" | "end";
  // Shown above the entries and not focusable: who is signed in.
  readonly header?: ReactNode;
  readonly className?: string;
}

// A list of actions, unlike `Menu`, which chooses one value. On Base UI: arrow keys, typing
// to jump, Escape returning focus to the trigger.
export function ActionMenu({
  label,
  trigger,
  entries,
  align = "end",
  header,
  className,
}: ActionMenuProps) {
  const container = usePortalContainer();

  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger
        aria-label={label}
        className={cn(
          "ui-action-menu__trigger inline-flex cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent p-1 text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring data-popup-open:bg-muted",
          className,
        )}
      >
        {trigger}
      </BaseMenu.Trigger>
      <BaseMenu.Portal container={container}>
        <BaseMenu.Positioner side="bottom" align={align} sideOffset={4} className="z-20">
          <BaseMenu.Popup className="ui-action-menu__panel min-w-56 max-w-[min(20rem,calc(100vw-1rem))] rounded-md border border-border bg-surface p-1 text-fg shadow-md outline-none">
            {header ? (
              <div className="ui-action-menu__header border-b border-border px-2 pb-2 pt-1 text-sm">
                {header}
              </div>
            ) : null}
            {entries.map((entry) => ActionMenu.entry(entry))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

ActionMenu.entry = (entry: ActionMenuEntry): ReactNode => {
  if (entry.kind === "separator") {
    return <BaseMenu.Separator key={entry.key} className="my-1 h-px bg-border" />;
  }
  if (entry.kind === "heading") {
    return (
      <div key={entry.key} className="px-2 pb-1 pt-2 text-xs text-fg-muted">
        {entry.label}
      </div>
    );
  }
  return (
    <BaseMenu.Item
      key={entry.key}
      disabled={entry.disabled}
      onClick={entry.onSelect}
      className={cn(
        "ui-action-menu__item flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-muted",
        entry.tone === "danger" ? "text-danger" : "text-fg",
      )}
    >
      {entry.icon ? <Icon name={entry.icon} size={16} /> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{entry.label}</span>
        {entry.detail ? (
          <span className="truncate text-xs text-fg-muted">{entry.detail}</span>
        ) : null}
      </span>
      {entry.checked ? <Icon name="check" size={16} /> : null}
    </BaseMenu.Item>
  );
};
