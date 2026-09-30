import { buttonClassName } from "../button/index.js";
import { type ReactNode, useEffect, useId, useRef, useState } from "../import.js";

export type PopoverAlign = "start" | "end";

export interface PopoverProps {
  // The accessible name of both the trigger and the panel. One string, because a
  // popover whose button and dialog are named differently reads as two things.
  readonly label: string;
  // What the trigger renders. A node rather than a string: the bell is an icon and a
  // badge, and a `label` prop cannot carry either.
  readonly trigger: ReactNode;
  readonly children: ReactNode;
  // Which edge the panel lines up with. `end` is the right one for anything in a header
  // bar, which is where the first caller is.
  readonly align?: PopoverAlign;
  readonly className?: string;
}

// A panel anchored to the control that opened it, closing on Escape, on a click outside,
// and on the trigger. See docs/reference/popover.md for what it is deliberately not.
export function Popover({ label, trigger, children, align = "end", className }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const control = useRef<HTMLButtonElement>(null);

  // Bound only while it is open, so a page of twenty closed popovers holds no listeners.
  useEffect(() => {
    if (!open) return;

    const close = () => {
      setOpen(false);
      control.current?.focus();
    };

    // `pointerdown`, not `click`: a click fires after the element under it may already
    // have gone, and a popover that closed on the way up would swallow the first press.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && wrapper.current?.contains(target)) return;
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapper} className={["ui-popover", className].filter(Boolean).join(" ")}>
      <button
        ref={control}
        type="button"
        className={buttonClassName("ghost", "ui-popover__trigger")}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        {trigger}
      </button>

      {
        // Unmounted rather than hidden. The panel's content is a query, and a hidden one
        // would fetch on every page that renders the trigger.
      }
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={label}
          className={`ui-popover__panel ui-popover__panel--${align}`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
