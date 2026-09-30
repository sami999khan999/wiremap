import { z } from "../import.js";

// Long enough for any callback a provider signs, short enough that a params object is
// not a place to smuggle a payload.
const URL_MAX = 2048;

// One entry per message this system can send, and the reason it is a manifest rather
// than a union of interfaces: a job crosses a queue as JSON, so the worker parses.
const TEMPLATES = {
  "auth.verify": z.object({ url: z.url().max(URL_MAX) }),
  "auth.reset": z.object({ url: z.url().max(URL_MAX) }),
  "auth.change": z.object({ url: z.url().max(URL_MAX) }),
  // The one payload that is not a link: a second factor must not need a browser the
  // sign-in is not happening in.
  "auth.otp": z.object({ code: z.string().min(1).max(32) }),
  "member.invitation": z.object({
    url: z.url().max(URL_MAX),
    inviter: z.string().min(1).max(200),
    organization: z.string().min(1).max(200),
  }),
  // One notification, sent at once. `kind` picks the copy, so the message says what
  // happened without the params carrying the row it happened to.
  "notification.single": z.object({
    kind: z.string().min(1).max(64),
    name: z.string().max(200),
    url: z.string().max(URL_MAX),
  }),
  // A day of them in one message. A count rather than a list: the digest links to the
  // inbox, and rendering N rows in mail is a second layout to keep translated.
  "notification.digest": z.object({
    count: z.number().int().nonnegative(),
    name: z.string().max(200),
    organization: z.string().min(1).max(200),
    url: z.string().max(URL_MAX),
  }),
} as const;

export type MailTemplateKey = keyof typeof TEMPLATES;

const KEYS: readonly MailTemplateKey[] = Object.freeze(Object.keys(TEMPLATES) as MailTemplateKey[]);

export type MailTemplateParams<K extends MailTemplateKey> = z.infer<(typeof TEMPLATES)[K]>;

// Closed on purpose. The renderer switches on the key with a `never` default, so adding
// a row here does not compile until copy and a template exist for it.
export class MailTemplates {
  private constructor() {}

  public static schema<K extends MailTemplateKey>(key: K): (typeof TEMPLATES)[K] {
    return TEMPLATES[key];
  }

  // `Object.hasOwn`, not a bare index, for the reason `ProcedurePermissions` gives:
  // `TEMPLATES["toString"]` otherwise resolves up the prototype chain to a function.
  public static isKnown(key: string): key is MailTemplateKey {
    return Object.hasOwn(TEMPLATES, key);
  }

  public static keys(): readonly MailTemplateKey[] {
    return KEYS;
  }
}
