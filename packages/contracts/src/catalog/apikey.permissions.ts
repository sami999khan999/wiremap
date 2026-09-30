import type { PermissionKey } from "../import.js";

// One entry per path in `ApiKeyProcedures`. Create and revoke share `apikey.manage`: a
// role that can issue a credential must be able to take it back.
export const apiKeyProcedurePermissions = {
  "apiKey.list": "apikey.read",
  "apiKey.create": "apikey.manage",
  "apiKey.revoke": "apikey.manage",
} as const satisfies Record<string, PermissionKey>;
