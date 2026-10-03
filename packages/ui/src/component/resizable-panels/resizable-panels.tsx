import { cn } from "../../class-name/index.js";
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "../../import.js";

export interface ResizablePanelsProps {
  readonly start?: ReactNode;
  readonly children: ReactNode;
  readonly end?: ReactNode;
  // Accessible names for the two dividers, which are what a keyboard user moves.
  readonly startLabel?: string;
  readonly endLabel?: string;
  readonly defaultStart?: number;
  readonly defaultEnd?: number;
  readonly min?: number;
  readonly max?: number;
  // Widths are remembered per viewer in localStorage under this key, when given.
  readonly storageKey?: string;
  readonly className?: string;
}

const STEP = 16;

// Up to three columns with draggable dividers, on CSS grid. Below `lg` the columns stack and
// the dividers go, because a phone has no width to share.
export function ResizablePanels({
  start,
  children,
  end,
  startLabel = "Resize the left panel",
  endLabel = "Resize the right panel",
  defaultStart = 240,
  defaultEnd = 320,
  min = 180,
  max = 560,
  storageKey,
  className,
}: ResizablePanelsProps) {
  const [widths, setWidths] = useState({ start: defaultStart, end: defaultEnd });
  const clamp = useCallback((value: number) => Math.min(max, Math.max(min, value)), [min, max]);

  // Read after mount: the server renders the defaults, and storage can throw in a private window.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as typeof widths | null;
      if (saved) setWidths({ start: clamp(saved.start), end: clamp(saved.end) });
    } catch {
      // Defaults stand.
    }
  }, [storageKey, clamp]);

  const save = useCallback(
    (next: typeof widths) => {
      setWidths(next);
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // A blocked store only means the width is not remembered.
      }
    },
    [storageKey],
  );

  const style = {
    "--panes-start": start ? `${widths.start}px` : "0px",
    "--panes-end": end ? `${widths.end}px` : "0px",
  } as CSSProperties;

  return (
    <div
      className={cn(
        "ui-resizable-panels flex min-h-0 flex-col lg:grid lg:grid-cols-[var(--panes-start)_auto_minmax(0,1fr)_auto_var(--panes-end)]",
        className,
      )}
      style={style}
    >
      {start ? (
        <div className="ui-resizable-panels__start min-h-0 min-w-0 overflow-hidden">{start}</div>
      ) : (
        <div />
      )}
      {start ? (
        <Divider
          label={startLabel}
          value={widths.start}
          min={min}
          max={max}
          onChange={(value) => save({ ...widths, start: clamp(value) })}
          direction={1}
        />
      ) : (
        <div />
      )}
      <div className="ui-resizable-panels__center min-h-0 min-w-0 overflow-hidden">{children}</div>
      {end ? (
        <Divider
          label={endLabel}
          value={widths.end}
          min={min}
          max={max}
          onChange={(value) => save({ ...widths, end: clamp(value) })}
          direction={-1}
        />
      ) : (
        <div />
      )}
      {end ? (
        <div className="ui-resizable-panels__end min-h-0 min-w-0 overflow-hidden">{end}</div>
      ) : (
        <div />
      )}
    </div>
  );
}

interface DividerProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
  // +1 when dragging right widens the panel (the left one), -1 when it narrows it.
  readonly direction: 1 | -1;
}

function Divider({ label, value, min, max, onChange, direction }: DividerProps) {
  const drag = useRef<{ x: number; value: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: event.clientX, value };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onChange(drag.current.value + (event.clientX - drag.current.x) * direction);
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = {
      ArrowLeft: value - STEP * direction,
      ArrowRight: value + STEP * direction,
      Home: min,
      End: max,
    };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onChange(next);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter has no native element; <hr> takes no focus
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      className="ui-resizable-panels__divider hidden w-1 cursor-col-resize bg-border outline-none transition-colors hover:bg-primary focus-visible:bg-ring lg:block"
    />
  );
}
