import type { FileRole } from "../import.js";
import type { ExplorerState } from "./explorer-model.js";

// The explorer's URL parameters. Short names, because the folder list grows with every
// folder opened and the whole of it is what a shared link carries.
export interface ExplorerSearch {
  readonly depth?: number | undefined;
  readonly open?: string | undefined;
  readonly role?: string | undefined;
  readonly folder?: string | undefined;
  readonly repo?: string | undefined;
  readonly sel?: string | undefined;
  readonly impact?: boolean | undefined;
}

export class ExplorerUrl {
  private constructor() {}

  public static readonly DEFAULT_DEPTH = 2;

  public static toState(search: ExplorerSearch): ExplorerState {
    return {
      depth: search.depth ?? ExplorerUrl.DEFAULT_DEPTH,
      expanded: new Set(search.open ? search.open.split(",").filter(Boolean) : []),
      role: (search.role as FileRole | undefined) ?? null,
      folder: search.folder ?? null,
      repository: search.repo ?? null,
      selected: search.sel ?? null,
      impact: search.impact ?? false,
    };
  }

  // Only what differs from the default, so an untouched explorer has a bare URL.
  public static toSearch(state: ExplorerState): ExplorerSearch {
    return {
      ...(state.depth !== ExplorerUrl.DEFAULT_DEPTH ? { depth: state.depth } : {}),
      ...(state.expanded.size > 0 ? { open: [...state.expanded].sort().join(",") } : {}),
      ...(state.role ? { role: state.role } : {}),
      ...(state.folder ? { folder: state.folder } : {}),
      ...(state.repository ? { repo: state.repository } : {}),
      ...(state.selected ? { sel: state.selected } : {}),
      ...(state.impact ? { impact: true } : {}),
    };
  }
}
