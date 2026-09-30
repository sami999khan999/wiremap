import type { MessageBundle, MessageKey, MessageParams, Namespace } from "../message/index.js";
import type { Locale } from "../primitive/index.js";

// The wire format. This exact object is what apps/web inlines into the HTML.
export interface MessageSnapshot {
  readonly locale: Locale;
  // Which namespaces `base` and `overrides` cover. Always includes the shell.
  readonly namespaces: readonly Namespace[];
  // The layer beneath, read only where `overrides` has no key. `StaticContentSource`
  // leaves it empty — its bundles are total — and a CMS source is what it exists for.
  readonly base: MessageBundle;
  // The requested locale, loaded namespaces only. The static source puts every locale
  // here, English included, so a snapshot is one layer unless something supplies two.
  readonly overrides: MessageBundle;
}

export class Translator {
  public constructor(private readonly snapshot: MessageSnapshot) {}

  public get locale(): Locale {
    return this.snapshot.locale;
  }

  public loaded(namespace: Namespace): boolean {
    return this.snapshot.namespaces.includes(namespace);
  }

  // `{name}` interpolation, no library. An unknown placeholder or an unloaded key is
  // left verbatim rather than rendered as `undefined` — loud and local, never plausible.
  public t(key: MessageKey, params?: MessageParams): string {
    const template = this.snapshot.overrides[key] ?? this.snapshot.base[key];
    if (template === undefined) return key;
    if (!params) return template;

    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  }

  public has(key: MessageKey): boolean {
    return key in this.snapshot.overrides || key in this.snapshot.base;
  }

  // Immutable, so per-recipient composition builds on a shared instance.
  public with(overrides: MessageBundle): Translator {
    return new Translator({
      ...this.snapshot,
      overrides: { ...this.snapshot.overrides, ...overrides },
    });
  }

  // Union of two snapshots of one locale. Used when a navigation adds namespaces.
  public static merge(a: MessageSnapshot, b: MessageSnapshot): MessageSnapshot {
    return {
      locale: a.locale,
      namespaces: [...new Set([...a.namespaces, ...b.namespaces])],
      base: { ...a.base, ...b.base },
      overrides: { ...a.overrides, ...b.overrides },
    };
  }
}
