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
    messaging: async () => (await import("./en/messaging.js")).messaging,
    notification: async () => (await import("./en/notification.js")).notification,
    analytics: async () => (await import("./en/analytics.js")).analytics,
    platform: async () => (await import("./en/platform.js")).platform,
    widget: async () => (await import("./en/widget.js")).widget,
    doc: async () => (await import("./en/doc.js")).doc,
  },
  bn: {
    common: async () => (await import("./bn/common.js")).common,
    error: async () => (await import("./bn/error.js")).error,
    nav: async () => (await import("./bn/nav.js")).nav,
    auth: async () => (await import("./bn/auth.js")).auth,
    account: async () => (await import("./bn/account.js")).account,
    role: async () => (await import("./bn/role.js")).role,
    member: async () => (await import("./bn/member.js")).member,
    organization: async () => (await import("./bn/organization.js")).organization,
    apikey: async () => (await import("./bn/apikey.js")).apikey,
    document: async () => (await import("./bn/document.js")).document,
    messaging: async () => (await import("./bn/messaging.js")).messaging,
    notification: async () => (await import("./bn/notification.js")).notification,
    analytics: async () => (await import("./bn/analytics.js")).analytics,
    platform: async () => (await import("./bn/platform.js")).platform,
    widget: async () => (await import("./bn/widget.js")).widget,
    doc: async () => (await import("./bn/doc.js")).doc,
  },
};
