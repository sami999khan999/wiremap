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
import { Icon } from "../icon/index.js";

export interface AppShellProps {
  // The sidebar's whole content: its header, navigation and footer.
  readonly sidebar: ReactNode;
  // The brand shown in the phone bar, where the sidebar is a drawer.
  readonly brand: ReactNode;
  readonly children: ReactNode;
  readonly sidebarLabel: string;
  readonly openLabel: string;
  readonly closeLabel: string;
  readonly resizeLabel: string;
  // Where the chosen width is kept between visits; per browser, a convenience only.
  readonly storageKey?: string;
  // Closes the phone drawer, which should happen on every navigation.
  readonly navigationKey?: string;
}

const MIN = 208;
const MAX = 360;
const DEFAULT = 256;
const STEP = 16;

// The signed-in frame: a full-height sidebar the reader can widen or narrow, and the page.
// Below `md` the sidebar is a drawer behind a bar, so a phone keeps its whole width.
export function AppShell({
  sidebar,
  brand,
  children,
  sidebarLabel,
  openLabel,
  closeLabel,
  resizeLabel,
  storageKey,
  navigationKey,
}: AppShellProps) {
  const [width, setWidth] = useState(DEFAULT);
  const [open, setOpen] = useState(false);
  const dragging = useRef<{ x: number; width: number } | null>(null);
  const clamp = (value: number) => Math.min(MAX, Math.max(MIN, Math.round(value)));

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (saved) setWidth(clamp(saved));
    } catch {
      // Storage refused (a private window): the default width stands.
    }
  }, [storageKey]);

  const save = useCallback(
    (next: number) => {
      setWidth(next);
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {
        // Not kept, which only costs the reader dragging it again next time.
      }
    },
    [storageKey],
  );

  useEffect(() => {
    void navigationKey;
    setOpen(false);
  }, [navigationKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    setWidth(clamp(dragging.current.width + event.clientX - dragging.current.x));
  };
  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = null;
    save(width);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") save(clamp(width - STEP));
    else if (event.key === "ArrowRight") save(clamp(width + STEP));
    else if (event.key === "Home") save(MIN);
    else if (event.key === "End") save(MAX);
    else return;
    event.preventDefault();
  };

  const handle = (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter has no native element; <hr> takes no focus
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={resizeLabel}
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      className="ui-app-shell__resize absolute inset-y-0 -right-1 hidden w-2 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-primary focus-visible:after:bg-primary md:block"
    />
  );

  return (
    <div className="ui-app-shell flex min-h-dvh">
      <div className="ui-app-shell__bar fixed inset-x-0 top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface px-4 md:hidden">
        <button
          type="button"
          aria-label={openLabel}
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-fg hover:bg-muted"
        >
          <Icon name="menu" size={18} />
        </button>
        {brand}
      </div>

      {open ? (
        <button
          type="button"
          aria-label={closeLabel}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 cursor-default border-0 bg-[color-mix(in_oklch,var(--bg)_60%,transparent)] md:hidden"
        />
      ) : null}

      <aside
        aria-label={sidebarLabel}
        style={{ "--sidebar-width": `${width}px` } as CSSProperties}
        className={cn(
          "ui-app-shell__sidebar fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-border bg-surface transition-transform duration-(--duration-base)",
          "md:sticky md:top-0 md:z-auto md:h-dvh md:w-(--sidebar-width) md:shrink-0 md:translate-x-0 md:transition-none",
          open ? "translate-x-0 shadow-lg" : "-translate-x-full",
        )}
      >
        {sidebar}
        {handle}
      </aside>

      <div className="ui-app-shell__content flex min-w-0 flex-1 flex-col pt-14 md:pt-0">
        {children}
      </div>
    </div>
  );
}
