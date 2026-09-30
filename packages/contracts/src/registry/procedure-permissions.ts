import { PROCEDURE_PERMISSIONS } from "../catalog/index.js";
import type { PermissionKey } from "../import.js";

const PATHS: readonly string[] = Object.freeze(Object.keys(PROCEDURE_PERMISSIONS));

// Every procedure path must appear in the catalog. The oRPC base middleware fails
// closed on any path that does not, so a forgotten entry denies the call.
export class ProcedurePermissions {
  private constructor() {}

  // `Object.hasOwn`, not a bare index — `PROCEDURE_PERMISSIONS["toString"]` resolves
  // up the prototype chain to a function, which would gate a procedure on garbage.
  public static required(path: string): PermissionKey | undefined {
    return Object.hasOwn(PROCEDURE_PERMISSIONS, path) ? PROCEDURE_PERMISSIONS[path] : undefined;
  }

  public static paths(): readonly string[] {
    return PATHS;
  }
}
