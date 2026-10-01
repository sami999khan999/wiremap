import { createContext, type ReactNode, useContext, useState } from "../import.js";
import type { ModeKey } from "./mode-registry.js";
import type { ThemeKey } from "./theme-registry.js";

// The scope's own element, where a portaled panel inside it mounts. `null` is the page.
const PortalContainer = createContext<HTMLElement | null>(null);

export interface ThemeScopeProps {
  readonly theme: ThemeKey;
  readonly mode: ModeKey;
  readonly children: ReactNode;
}

// The palette's selectors are not anchored to <html>, so these two attributes rescope all
// twelve colours inside. A panel opened in here portals in here, or it paints in the page's.
export function ThemeScope({ theme, mode, children }: ThemeScopeProps) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  return (
    <div ref={setElement} data-theme={theme} data-mode={mode} style={{ colorScheme: mode }}>
      <PortalContainer.Provider value={element}>{children}</PortalContainer.Provider>
    </div>
  );
}

// Where a Base UI portal should mount: the enclosing scope, or `undefined` for `body`.
export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainer) ?? undefined;
}
