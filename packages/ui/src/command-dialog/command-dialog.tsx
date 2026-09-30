import { cn } from "../class-name/index.js";
import { Icon } from "../icon/index.js";
import {
  BaseDialog,
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
import { usePortalContainer } from "../theme-scope/index.js";

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

// A search palette on Base UI's Dialog, which owns the focus trap, the inert page, Escape and
// focus back to the opener. The result list is ours: Enter follows the caller's link.
const STATUS = "ui-command__status m-0 px-4 py-6 text-center text-fg-muted text-sm";

// A matched word the server marks with <mark> is tinted, never a fill for the text to sit on.
const EXCERPT =
  "ui-command__excerpt truncate text-fg-muted text-xs [&_mark]:bg-[color-mix(in_oklch,var(--primary)_18%,transparent)] [&_mark]:text-fg";

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
  const container = usePortalContainer();
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [cursor, setCursor] = useState(0);

  const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  // A new result set starts at its first row, rather than keeping an index into the old one.
  useEffect(() => {
    setCursor(0);
  }, [items]);

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

  // A followed link closes it, delegated so the caller's link needs no handler of its own.
  const onPopupClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest("a")) onOpenChange(false);
  };

  let index = -1;

  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <BaseDialog.Portal container={container}>
        {
          // The page dimmed with --bg rather than black, for the reason Sidebar gives.
        }
        <BaseDialog.Backdrop className="ui-command__backdrop fixed inset-0 z-50 bg-[color-mix(in_oklch,var(--bg)_60%,transparent)]" />
        <BaseDialog.Popup
          aria-label={label}
          initialFocus={input}
          onClick={onPopupClick}
          className="ui-command fixed inset-x-0 top-[12vh] z-50 mx-auto flex max-h-[min(32rem,calc(100dvh-4rem))] w-[min(40rem,calc(100vw-2rem))] flex-col rounded-lg border border-border bg-surface p-0 text-fg shadow-lg outline-none"
        >
          <div className="ui-command__search flex items-center gap-2 border-border border-b px-4 text-fg-muted">
            <Icon name="search" size={18} />
            {
              // The field is the dialog's whole purpose and already carries the caret, so a
              // ring around it would frame the entire panel.
            }
            <input
              ref={input}
              className="ui-command__input h-(--control-height-lg) flex-1 border-0 bg-transparent text-base text-fg [font:inherit] placeholder:text-fg-muted placeholder:opacity-100 focus-visible:shadow-none focus-visible:outline-none"
              type="search"
              role="combobox"
              aria-label={label}
              aria-expanded={items.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={items.length > 0 ? `${listId}-${cursor}` : undefined}
              placeholder={placeholder}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>

          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            className="ui-command__list min-h-0 flex-1 overflow-y-auto p-2"
          >
            {loading && loadingLabel ? <p className={STATUS}>{loadingLabel}</p> : null}
            {!loading && query.trim().length > 0 && items.length === 0 ? (
              <p className={STATUS}>{emptyLabel}</p>
            ) : null}
            {groups.map((group) =>
              group.items.length === 0 ? null : (
                // biome-ignore lint/a11y/useSemanticElements: a listbox group, which no element is.
                <div key={group.key} role="group" aria-label={group.label}>
                  <p
                    className="ui-command__group mx-2 mt-2 mb-1 font-medium text-fg-muted text-xs"
                    aria-hidden="true"
                  >
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
                        className={cn(
                          "ui-command__item rounded-md",
                          active && "ui-command__item--active bg-muted",
                        )}
                        onMouseMove={() => setCursor(at)}
                      >
                        {renderLink(
                          item,
                          <>
                            <Icon
                              name={item.icon ?? "file"}
                              size={16}
                              className="mt-0.5 shrink-0 text-fg-muted"
                            />
                            <span className="ui-command__text flex min-w-0 flex-col gap-1">
                              <span className="ui-command__title font-medium">{item.title}</span>
                              {item.excerpt ? (
                                <span className={EXCERPT}>{item.excerpt}</span>
                              ) : null}
                            </span>
                          </>,
                          {
                            className:
                              "ui-command__link flex items-start gap-3 px-3 py-2 text-fg text-sm no-underline",
                          },
                        )}
                      </div>
                    );
                  })}
                </div>
              ),
            )}
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
