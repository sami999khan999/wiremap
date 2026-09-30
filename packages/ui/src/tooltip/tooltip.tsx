import { BaseTooltip, type ReactElement } from "../import.js";
import { usePortalContainer } from "../theme-scope/index.js";

export interface TooltipProps {
  // Supplementary text only. An icon button's name is its own `aria-label`, never this.
  readonly label: string;
  // The one element it describes, rendered as the trigger. It must accept a ref and props.
  readonly children: ReactElement;
  readonly side?: "top" | "bottom" | "left" | "right";
}

// A hint on hover and focus. Base UI owns the delays, Escape, and the description link.
export function Tooltip({ label, children, side = "top" }: TooltipProps) {
  const container = usePortalContainer();

  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal container={container}>
        <BaseTooltip.Positioner side={side} sideOffset={6} className="z-50">
          <BaseTooltip.Popup className="ui-tooltip max-w-64 rounded-sm border border-border bg-surface px-2 py-1 text-fg text-xs shadow-md">
            {label}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
