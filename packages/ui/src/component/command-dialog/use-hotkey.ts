import { useEffect, useRef } from "../../import.js";

export interface HotkeyOptions {
  // Ctrl on Windows and Linux, Cmd on macOS: whichever the reader's platform means.
  readonly mod?: boolean;
}

// One document listener per call, and the handler read through a ref so a re-render with
// a new closure does not unbind and rebind it.
export function useHotkey(key: string, handler: () => void, options: HotkeyOptions = {}): void {
  const latest = useRef(handler);
  const mod = options.mod ?? false;

  // After render rather than during it, which React allows no ref write in.
  useEffect(() => {
    latest.current = handler;
  });

  useEffect(() => {
    const wanted = key.toLowerCase();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== wanted) return;
      if (mod !== (event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [key, mod]);
}
