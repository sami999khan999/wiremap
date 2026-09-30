import type { Namespace } from "../message/index.js";
import type { Locale } from "../primitive/index.js";
import type { ContentSource } from "../source/index.js";
import { type MessageSnapshot, Translator } from "./translator.js";

// The mutable holder around an immutable snapshot, because navigation adds namespaces
// after render. React-free, so it works in every process.
export class MessageStore {
  private snapshot: MessageSnapshot;
  private cached: Translator;
  private readonly listeners = new Set<() => void>();
  // Keyed by locale *and* namespace, so a load still running when the locale changes
  // cannot be joined by a caller that now wants the other language's copy.
  private readonly inFlight = new Map<string, Promise<void>>();

  // A factory rather than a constant, because a snapshot carries its locale — and
  // `namespaces: []` is what makes `ensure()` fetch what the first navigation asks for.
  public static empty(locale: Locale): MessageSnapshot {
    return { locale, namespaces: [], base: {}, overrides: {} };
  }

  public constructor(
    private readonly content: ContentSource,
    initial: MessageSnapshot,
  ) {
    this.snapshot = initial;
    this.cached = new Translator(initial);
  }

  // Stable identity until `ensure()` adds something: `useSyncExternalStore` re-renders
  // forever if its read function returns a new object every call.
  public get translator(): Translator {
    return this.cached;
  }

  public dehydrate(): MessageSnapshot {
    return this.snapshot;
  }

  public restore(snapshot: MessageSnapshot): void {
    this.snapshot = snapshot;
    this.cached = new Translator(snapshot);
  }

  // Drops every loaded namespace, because they are the *previous* locale's copy — a
  // merge would leave the old sentences in place under keys the new bundle also has.
  public setLocale(locale: Locale): void {
    if (this.snapshot.locale === locale) return;

    this.restore(MessageStore.empty(locale));
    for (const listener of this.listeners) listener();
  }

  // Idempotent, and resolves immediately when nothing is missing — which is the common
  // case on a navigation between two routes that declare the same namespaces.
  public async ensure(namespaces: readonly Namespace[]): Promise<void> {
    const { locale } = this.snapshot;
    const missing = namespaces.filter((name) => !this.snapshot.namespaces.includes(name));
    if (missing.length === 0) return;

    // Per namespace, not per requested set: two routes asking for overlapping sets in the
    // same tick share the fetch for what they have in common instead of both asking.
    const fresh = missing.filter((name) => !this.inFlight.has(MessageStore.key(locale, name)));

    if (fresh.length > 0) {
      const load = this.load(locale, fresh);
      for (const name of fresh) this.inFlight.set(MessageStore.key(locale, name), load);
    }

    const waits: Promise<void>[] = [];
    for (const name of missing) {
      const pending = this.inFlight.get(MessageStore.key(locale, name));
      if (pending) waits.push(pending);
    }

    await Promise.all(waits);
  }

  private async load(locale: Locale, namespaces: readonly Namespace[]): Promise<void> {
    try {
      const added = await this.content.messages(locale, namespaces);

      // The locale can change while this is in flight, and what came back is the previous
      // one's copy. Merging it puts the old sentences under keys the new bundle also has.
      if (this.snapshot.locale !== locale) return;

      this.restore(Translator.merge(this.snapshot, added));
      for (const listener of this.listeners) listener();
    } finally {
      for (const name of namespaces) this.inFlight.delete(MessageStore.key(locale, name));
    }
  }

  private static key(locale: Locale, namespace: Namespace): string {
    return `${locale}:${namespace}`;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
