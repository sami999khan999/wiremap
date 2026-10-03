import type { account } from "./en/account.js";
import type { activity } from "./en/activity.js";
import type { apikey } from "./en/apikey.js";
import type { auth } from "./en/auth.js";
import type { common } from "./en/common.js";
import type { doc } from "./en/doc.js";
import type { document } from "./en/document.js";
import type { email } from "./en/email.js";
import type { error } from "./en/error.js";
import type { graph } from "./en/graph.js";
import type { member } from "./en/member.js";
import type { nav } from "./en/nav.js";
import type { notification } from "./en/notification.js";
import type { organization } from "./en/organization.js";
import type { platform } from "./en/platform.js";
import type { project } from "./en/project.js";
import type { role } from "./en/role.js";
import type { scan } from "./en/scan.js";
import type { team } from "./en/team.js";

// Type-only. `verbatimModuleSyntax` erases the imports above, so the key union stays
// complete while the runtime data splits into one chunk per locale × namespace.
interface NamespaceShape {
  readonly common: typeof common;
  readonly nav: typeof nav;
  readonly auth: typeof auth;
  readonly account: typeof account;
  readonly role: typeof role;
  readonly member: typeof member;
  readonly organization: typeof organization;
  readonly platform: typeof platform;
  readonly apikey: typeof apikey;
  readonly document: typeof document;
  readonly notification: typeof notification;
  readonly doc: typeof doc;
  readonly team: typeof team;
  readonly activity: typeof activity;
  readonly project: typeof project;
  readonly scan: typeof scan;
  readonly graph: typeof graph;
  readonly error: typeof error;
  readonly email: typeof email;
}

// Always present, in every snapshot, from every ContentSource. Never lazy.
export type ShellNamespace = "common" | "error";
// Everything a browser or desktop bundle may load. Lazy: a route declares what it needs.
export type ClientNamespace =
  | ShellNamespace
  | "nav"
  | "auth"
  | "account"
  | "role"
  | "member"
  | "organization"
  | "apikey"
  | "notification"
  | "document"
  | "platform"
  | "doc"
  | "team"
  | "activity"
  | "project"
  | "scan"
  | "graph";
// Never reachable from a client catalog — only `SERVER_CATALOG` carries a loader for it.
export type ServerNamespace = "email";
export type Namespace = ClientNamespace | ServerNamespace;

export type NamespaceKeys = { [K in Namespace]: keyof NamespaceShape[K] & string };

// The complete closed union. A typo at a call site is a compile error.
export type MessageKey = NamespaceKeys[Namespace];

// Only the always-loaded keys, so `ERROR_COPY` cannot point at a lazy namespace.
export type ShellMessageKey = NamespaceKeys[ShellNamespace];

// One locale's copy for one namespace, and **total**: a key added to `en` without a
// translation is a compile error here rather than an English sentence in a Bengali page.
export type NamespaceBundle<N extends Namespace> = Record<NamespaceKeys[N], string>;

// A flat slice across whatever namespaces are loaded.
export type MessageBundle = Partial<Record<MessageKey, string>>;

// What `t()` interpolates. `boolean` is here because `ErrorContext` allows it.
export type MessageParams = Readonly<Record<string, string | number | boolean>>;

export const SHELL_NAMESPACES: readonly ShellNamespace[] = ["common", "error"];
export const CLIENT_NAMESPACES: readonly ClientNamespace[] = [
  "common",
  "error",
  "nav",
  "auth",
  "account",
  "role",
  "member",
  "organization",
  "apikey",
  "document",
  "notification",
  "platform",
  "doc",
  "team",
  "activity",
  "project",
  "scan",
  "graph",
];
