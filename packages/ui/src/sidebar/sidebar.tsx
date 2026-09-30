import { type ReactNode, useEffect } from "../import.js";

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

// A column that stays put while the page scrolls, and a drawer below the breakpoint.
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
        className={["ui-sidebar", open ? "ui-sidebar--open" : null, className]
          .filter(Boolean)
          .join(" ")}
      >
        {header ? <div className="ui-sidebar__header">{header}</div> : null}
        <div className="ui-sidebar__body">{children}</div>
        {footer ? <div className="ui-sidebar__footer">{footer}</div> : null}
      </aside>
      {open ? (
        <button
          type="button"
          className="ui-sidebar__backdrop"
          aria-label={closeLabel}
          onClick={() => onOpenChange?.(false)}
        />
      ) : null}
    </>
  );
}
