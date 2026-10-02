import { describe, expect, it } from "vitest";
import type { NavItem } from "../../src/collection/index.js";
import type { ResolvedMedia } from "../../src/media/index.js";
import type { Namespace } from "../../src/message/index.js";
import type { Locale } from "../../src/primitive/index.js";
import { ContentSource } from "../../src/source/index.js";
import { MessageStore } from "../../src/translator/message-store.js";
import type { MessageSnapshot, Translator } from "../../src/translator/translator.js";

interface Pending {
  readonly locale: Locale;
  readonly namespaces: readonly Namespace[];
  readonly settle: () => void;
}

// The real abstract class rather than an object literal: a method added to the seam is a
// compile error here, which is the point of `ContentSource` being a class at all.
class DeferredContentSource extends ContentSource {
  public readonly calls: Pending[] = [];

  public override messages(
    locale: Locale,
    namespaces: readonly Namespace[],
  ): Promise<MessageSnapshot> {
    return new Promise<MessageSnapshot>((resolve) => {
      this.calls.push({
        locale,
        namespaces,
        settle: () =>
          resolve({
            locale,
            namespaces,
            // One key per namespace, so a merge that dropped one is visible.
            base: Object.fromEntries(namespaces.map((name) => [`${name}.key`, name])),
            overrides: {},
          } as MessageSnapshot),
      });
    });
  }

  public override translator(): Promise<Translator> {
    throw new Error("unused");
  }

  public override media(): Promise<ResolvedMedia> {
    throw new Error("unused");
  }

  public override nav(): Promise<readonly NavItem[]> {
    throw new Error("unused");
  }
}

const store = (source: ContentSource) => new MessageStore(source, MessageStore.empty("en"));

describe("MessageStore.ensure", () => {
  it("asks once when two callers want the same namespace in the same tick", async () => {
    const source = new DeferredContentSource();
    const messages = store(source);

    const first = messages.ensure(["nav"]);
    const second = messages.ensure(["nav"]);

    // The regression: neither call had resolved, so `snapshot.namespaces` was still empty
    // for the second one and both went to the source.
    expect(source.calls).toHaveLength(1);

    source.calls[0]?.settle();
    await Promise.all([first, second]);

    expect(messages.translator.loaded("nav")).toBe(true);
  });

  it("shares the overlap and fetches only what is genuinely new", async () => {
    const source = new DeferredContentSource();
    const messages = store(source);

    const first = messages.ensure(["nav", "auth"]);
    const second = messages.ensure(["auth", "role"]);

    // De-duplicated per namespace, not per requested set: `auth` is joined, `role` is the
    // only thing the second call adds.
    expect(source.calls.map((call) => call.namespaces)).toEqual([["nav", "auth"], ["role"]]);

    for (const call of source.calls) call.settle();
    await Promise.all([first, second]);

    for (const name of ["nav", "auth", "role"] as const) {
      expect(messages.translator.loaded(name)).toBe(true);
    }
  });

  it("asks again after the load settles, rather than caching the promise forever", async () => {
    const source = new DeferredContentSource();
    const messages = store(source);

    const first = messages.ensure(["nav"]);
    source.calls[0]?.settle();
    await first;

    // Loaded now, so this is answered from the snapshot and never reaches the source.
    await messages.ensure(["nav"]);
    expect(source.calls).toHaveLength(1);

    // Something genuinely new does reach it: the map holds a load in flight, not a
    // permanent record that the namespace was once asked for.
    const next = messages.ensure(["auth"]);
    expect(source.calls).toHaveLength(2);

    source.calls[1]?.settle();
    await next;
  });
});
