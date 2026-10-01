import { cn } from "../../class-name/index.js";
import { BasePopover, type ReactNode } from "../../import.js";
import { usePortalContainer } from "../../theme/index.js";
import { buttonClassName } from "../button/index.js";

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

// A panel anchored to the control that opened it, closing on Escape, on a press outside
// and on the trigger, on Base UI. See docs/reference/popover.md for what it is not.
export function Popover({ label, trigger, children, align = "end", className }: PopoverProps) {
  const container = usePortalContainer();

  return (
    <BasePopover.Root>
      <span className={cn("ui-popover inline-flex", className)}>
        <BasePopover.Trigger
          className={buttonClassName("ghost", "ui-popover__trigger")}
          aria-label={label}
        >
          {trigger}
        </BasePopover.Trigger>
      </span>
      {
        // Unmounted rather than hidden, Base UI's default: the panel's content is a query,
        // and a hidden one would fetch on every page that renders the trigger.
      }
      <BasePopover.Portal container={container}>
        <BasePopover.Positioner side="bottom" align={align} sideOffset={4} className="z-20">
          <BasePopover.Popup
            aria-label={label}
            className={cn(
              "ui-popover__panel",
              `ui-popover__panel--${align}`,
              "min-w-72 max-w-[min(24rem,calc(100vw-1rem))] rounded-md border border-border bg-surface p-2 text-fg shadow-md outline-none",
            )}
          >
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
