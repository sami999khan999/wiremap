import type { PermissionKey } from "../import.js";

// One entry per path in `DocumentProcedures`. Reading and writing the index are separate
// keys: a role that may search a corpus need not be one that may add to it.
export const documentProcedurePermissions = {
  "document.index": "ai.embedding.write",
  "document.search": "ai.embedding.read",
} as const satisfies Record<string, PermissionKey>;
