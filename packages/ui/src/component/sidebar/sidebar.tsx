import { cn } from "../../class-name/index.js";
import { type ReactNode, useEffect } from "../../import.js";
import { ScrollArea } from "../scroll-area/index.js";

export interface SidebarProps {
  // The region's accessible name. A page with a sidebar and a header nav has two
  // landmarks, and an unnamed one tells a screen reader nothing about which is which.
  readonly label: string;
  readonly header?: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  // Narrow screens only: on a wide one the sidebar is always in the layout. The button
  // that opens it lives in the page, which is why this is controlled.
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  // The backdrop's name. It is a button a keyboard user can reach, so it needs one.
  readonly closeLabel: string;
  readonly className?: string;
}

// A column that stays put while the page scrolls, and below 64rem a drawer over the page:
// the width at which a sidebar, an article and an outline stop fitting side by side.
export function Sidebar({
  label,
  header,
  footer,
  children,
  open = false,
  onOpenChange,
  closeLabel,
  className,
}: SidebarProps) {
  // Bound only while the drawer is open, as the popover does: a closed one holds nothing.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange?.(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  return (
    <>
      <aside
        aria-label={label}
        className={cn(
          "ui-sidebar sticky top-0 flex h-dvh w-70 shrink-0 flex-col border-border border-r bg-bg text-fg",
          "max-lg:invisible max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:w-[min(20rem,85vw)] max-lg:-translate-x-full max-lg:shadow-lg max-lg:transition-[translate,visibility]",
          open && "ui-sidebar--open max-lg:visible max-lg:translate-x-0",
          className,
        )}
      >
        {header ? (
          <div className="ui-sidebar__header flex flex-col gap-3 px-4 pt-4 pb-2">{header}</div>
        ) : null}
        {
          // The only part that scrolls, so the search field and the footer never leave the screen.
        }
        <ScrollArea
          className="ui-sidebar__body min-h-0 flex-1"
          contentClassName="overscroll-contain px-4 pt-2 pb-4"
        >
          {children}
        </ScrollArea>
        {footer ? (
          <div className="ui-sidebar__footer flex items-center justify-between gap-2 border-border border-t px-4 py-3">
            {footer}
          </div>
        ) : null}
      </aside>
      {open ? (
        // The page dimmed with --bg rather than black: in a dark theme a light scrim would
        // read as a panel rather than as a shade.
        <button
          type="button"
          className="ui-sidebar__backdrop fixed inset-0 z-39 hidden cursor-pointer border-0 bg-[color-mix(in_oklch,var(--bg)_60%,transparent)] p-0 max-lg:block"
          aria-label={closeLabel}
          onClick={() => onOpenChange?.(false)}
        />
      ) : null}
    </>
  );
}
