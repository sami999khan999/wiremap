import { GlassScrollArea, type ReactNode } from "../../import.js";

export interface ScrollAreaProps {
  // Sizes the area: it must have a bounded height, from a flex parent or a max-height.
  readonly className?: string;
  // The scroller itself: padding belongs here, so the bar sits on the area's edge.
  readonly contentClassName?: string;
  // The region's name, when the scroller is reachable by keyboard and needs announcing.
  readonly label?: string;
  readonly children: ReactNode;
}

// A pane with its own glass bar, for the scrollers a reader uses all the time: the doc
// sidebar and the outline. Takes its colours from `PageScrollbar`, which must wrap it.
export function ScrollArea({ className, contentClassName, label, children }: ScrollAreaProps) {
  return (
    <GlassScrollArea
      revealOnMount={false}
      {...(className ? { className } : {})}
      scrollerProps={{
        ...(contentClassName ? { className: contentClassName } : {}),
        ...(label ? { "aria-label": label, role: "region" } : {}),
      }}
    >
      {children}
    </GlassScrollArea>
  );
}
