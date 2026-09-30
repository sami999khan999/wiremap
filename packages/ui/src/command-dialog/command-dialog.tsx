import { Icon } from "../icon/index.js";
import {
  type IconName,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "../import.js";
import type { LinkAttributes } from "../nav-tree/index.js";

export interface CommandItem {
  readonly id: string;
  readonly title: string;
  readonly excerpt?: string;
  readonly href: string;
  readonly icon?: IconName;
}

export interface CommandGroup {
  readonly key: string;
  readonly label: string;
  readonly items: readonly CommandItem[];
}

export type RenderCommandLink = (
  item: CommandItem,
  content: ReactNode,
  attributes: LinkAttributes,
) => ReactNode;

export interface CommandDialogProps {
  // The dialog's accessible name, and the search field's.
  readonly label: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly placeholder: string;
  // Shown for a query with no results. Nothing is shown for an empty query.
  readonly emptyLabel: string;
  readonly loadingLabel?: string;
  readonly loading?: boolean;
  readonly groups: readonly CommandGroup[];
  readonly renderLink: RenderCommandLink;
}

// A search palette on the native `<dialog>`: `showModal()` is the browser's own focus
// trap, inert background and Escape, which is why this is not the hand-rolled Dialog.
export function CommandDialog({
  label,
  open,
  onOpenChange,
  query,
  onQueryChange,
  placeholder,
  emptyLabel,
  loadingLabel,
  loading = false,
  groups,
  renderLink,
}: CommandDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [cursor, setCursor] = useState(0);

  const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  // A new result set starts at its first row, rather than keeping an index into the old one.
  useEffect(() => {
    setCursor(0);
  }, [items]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      // jsdom and older engines lack the method, and then the attribute is the fallback.
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    }
    if (!open && element.open) {
      if (typeof element.close === "function") element.close();
      else element.removeAttribute("open");
    }
  }, [open]);

  // Keeps the highlighted row visible as the arrow keys walk past the fold.
  useEffect(() => {
    const row = listRef.current?.querySelector(`[data-index="${cursor}"]`);
    if (row instanceof HTMLElement) row.scrollIntoView?.({ block: "nearest" });
  }, [cursor]);

  const follow = (index: number) => {
    const row = listRef.current?.querySelector(`[data-index="${index}"]`);
    const anchor = row?.querySelector("a");
    // A click, so the caller's router link does the navigating rather than this component.
    if (anchor instanceof HTMLElement) anchor.click();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = items.length - 1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((at) => (at >= last ? 0 : at + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((at) => (at <= 0 ? Math.max(0, last) : at - 1));
    } else if (event.key === "Enter" && items.length > 0) {
      event.preventDefault();
      follow(cursor);
    }
  };

  // A press on the backdrop lands on the dialog itself, never on its panel. A followed
  // link closes it too, delegated so the caller's link needs no handler of its own.
  const onDialogClick = (event: MouseEvent<HTMLDialogElement>) => {
    const target = event.target;
    if (target === event.currentTarget) onOpenChange(false);
    else if (target instanceof Element && target.closest("a")) onOpenChange(false);
  };

  let index = -1;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape is the dialog's own, natively.
    <dialog
      ref={dialog}
      aria-label={label}
      className="ui-command"
      onCancel={() => onOpenChange(false)}
      onClose={() => onOpenChange(false)}
      onClick={onDialogClick}
    >
      <div className="ui-command__panel">
        <div className="ui-command__search">
          <Icon name="search" size={18} />
          <input
            className="ui-command__input"
            type="search"
            role="combobox"
            aria-label={label}
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={items.length > 0 ? `${listId}-${cursor}` : undefined}
            placeholder={placeholder}
            value={query}
            autoFocus
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>

        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className="ui-command__list"
        >
          {loading && loadingLabel ? <p className="ui-command__status">{loadingLabel}</p> : null}
          {!loading && query.trim().length > 0 && items.length === 0 ? (
            <p className="ui-command__status">{emptyLabel}</p>
          ) : null}
          {groups.map((group) =>
            group.items.length === 0 ? null : (
              // biome-ignore lint/a11y/useSemanticElements: a listbox group, which no element is.
              <div key={group.key} role="group" aria-label={group.label}>
                <p className="ui-command__group" aria-hidden="true">
                  {group.label}
                </p>
                {group.items.map((item) => {
                  index += 1;
                  const at = index;
                  const active = at === cursor;
                  return (
                    <div
                      key={item.id}
                      id={`${listId}-${at}`}
                      role="option"
                      tabIndex={-1}
                      aria-selected={active}
                      data-index={at}
                      className={["ui-command__item", active ? "ui-command__item--active" : null]
                        .filter(Boolean)
                        .join(" ")}
                      onMouseMove={() => setCursor(at)}
                    >
                      {renderLink(
                        item,
                        <>
                          <Icon name={item.icon ?? "file"} size={16} />
                          <span className="ui-command__text">
                            <span className="ui-command__title">{item.title}</span>
                            {item.excerpt ? (
                              <span className="ui-command__excerpt">{item.excerpt}</span>
                            ) : null}
                          </span>
                        </>,
                        { className: "ui-command__link" },
                      )}
                    </div>
                  );
                })}
              </div>
            ),
          )}
        </div>
      </div>
    </dialog>
  );
}
