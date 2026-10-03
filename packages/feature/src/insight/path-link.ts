import type { ReactNode } from "../import.js";

// A path into the explorer, from a page that has no router: the route supplies the link.
export type RenderPath = (path: string, content: ReactNode) => ReactNode;
