import type { IconName, ModuleKey } from "../../import.js";
import type { NamespaceKeys } from "../../message/index.js";
import { NavContract, type NavItem } from "./nav.schema.js";

// Narrower than `NavItem` on all three string fields, so an unknown module, icon or
// label key is a **compile** error while this file is still a literal.
interface NavRecord {
  readonly module: ModuleKey;
  readonly labelKey: NamespaceKeys["nav"];
  readonly icon: IconName;
  readonly order: number;
}

const ITEMS = [
  { module: "project", labelKey: "nav.projects", icon: "folder", order: 1 },
  { module: "rbac", labelKey: "nav.roles", icon: "check", order: 10 },
  { module: "member", labelKey: "nav.members", icon: "user", order: 20 },
  { module: "team", labelKey: "nav.teams", icon: "team", order: 25 },
  { module: "access", labelKey: "nav.access", icon: "folder", order: 27 },
  { module: "ai", labelKey: "nav.ai", icon: "sparkle", order: 8 },
  { module: "webhook", labelKey: "nav.webhooks", icon: "webhook", order: 9 },
  { module: "apikey", labelKey: "nav.apiKeys", icon: "key", order: 30 },
  { module: "document", labelKey: "nav.documents", icon: "check", order: 40 },
  { module: "notification", labelKey: "nav.notifications", icon: "bell", order: 50 },
  { module: "organization", labelKey: "nav.organizationSettings", icon: "settings", order: 5 },
  { module: "audit", labelKey: "nav.audit", icon: "activity", order: 60 },
  { module: "doc", labelKey: "nav.docs", icon: "book", order: 85 },
  // Last, and invisible to everyone but a platform admin: `ModuleRegistry.isVisible`
  // calls `can()`, and a tenant's wildcard does not reach the platform scope.
  { module: "platform", labelKey: "nav.platform", icon: "key", order: 90 },
] as const satisfies readonly NavRecord[];

export const navItems: readonly NavItem[] = NavContract.collection.parse(ITEMS);
