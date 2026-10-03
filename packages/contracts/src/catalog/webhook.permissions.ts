import type { PermissionKey } from "../import.js";

// Outgoing webhooks send project events off the platform, so they are the organization's
// to manage, not any one project's.
export const webhookProcedurePermissions = {
  "webhook.list": "organization.webhook.manage",
  "webhook.create": "organization.webhook.manage",
  "webhook.update": "organization.webhook.manage",
  "webhook.remove": "organization.webhook.manage",
  "webhook.test": "organization.webhook.manage",
} as const satisfies Record<string, PermissionKey>;
