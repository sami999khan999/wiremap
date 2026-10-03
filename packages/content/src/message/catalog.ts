import type { Locale } from "../primitive/index.js";
import type { ClientNamespace, MessageBundle, Namespace } from "./namespace.js";

export type BundleLoader = () => Promise<MessageBundle>;

// The parameter type. A catalog need not cover every namespace — a client one omits `email`.
export type MessageCatalog = Readonly<Record<Locale, Partial<Record<Namespace, BundleLoader>>>>;

// Total over Locale × ClientNamespace, and every `import()` specifier is a literal: a
// computed one makes the bundler inline every match into the parent chunk.
export const CLIENT_CATALOG: Readonly<
  Record<Locale, Readonly<Record<ClientNamespace, BundleLoader>>>
> = {
  en: {
    common: async () => (await import("./en/common.js")).common,
    error: async () => (await import("./en/error.js")).error,
    nav: async () => (await import("./en/nav.js")).nav,
    auth: async () => (await import("./en/auth.js")).auth,
    account: async () => (await import("./en/account.js")).account,
    role: async () => (await import("./en/role.js")).role,
    member: async () => (await import("./en/member.js")).member,
    organization: async () => (await import("./en/organization.js")).organization,
    apikey: async () => (await import("./en/apikey.js")).apikey,
    document: async () => (await import("./en/document.js")).document,
    notification: async () => (await import("./en/notification.js")).notification,
    platform: async () => (await import("./en/platform.js")).platform,
    doc: async () => (await import("./en/doc.js")).doc,
    team: async () => (await import("./en/team.js")).team,
    activity: async () => (await import("./en/activity.js")).activity,
    project: async () => (await import("./en/project.js")).project,
    scan: async () => (await import("./en/scan.js")).scan,
    graph: async () => (await import("./en/graph.js")).graph,
    ask: async () => (await import("./en/ask.js")).ask,
    webhook: async () => (await import("./en/webhook.js")).webhook,
  },
};
