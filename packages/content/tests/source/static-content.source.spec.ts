import { describe, expect, it } from "vitest";
import { StaticContentSource } from "../../src/source/static-content.source.js";

describe("StaticContentSource", () => {
  // The shell is a property of the seam, not something a caller remembers to ask for.
  it("puts the shell namespaces in a snapshot nobody asked for anything in", async () => {
    const snapshot = await new StaticContentSource().messages("en", []);

    expect(snapshot.namespaces).toEqual(["common", "error"]);
    expect(snapshot.overrides["error.unexpected"]).toBe("Something went wrong. Please try again.");
    expect(snapshot.overrides["action.save"]).toBe("Save");
  });

  it("does not duplicate a namespace that was also requested", async () => {
    const snapshot = await new StaticContentSource().messages("en", ["error", "common"]);

    expect(snapshot.namespaces).toEqual(["common", "error"]);
  });

  // One layer, not two. English is the requested locale here like any other, so it
  // arrives in `overrides` rather than underneath itself.
  it("leaves the base layer empty for English", async () => {
    const snapshot = await new StaticContentSource().messages("en", []);

    expect(snapshot.base).toEqual({});
    expect(snapshot.overrides["action.cancel"]).toBe("Cancel");
  });

  // `23.15`: English used to ride beneath every locale, and a Bengali page carried
  // 3 471 characters of it that nothing could reach.
  it("ships no English beneath another locale, and still resolves that locale's keys", async () => {
    const snapshot = await new StaticContentSource().messages("bn", []);

    expect(snapshot.locale).toBe("bn");
    expect(snapshot.base).toEqual({});
    expect(snapshot.overrides["error.forbidden"]).toBe("এটি করার অনুমতি আপনার নেই।");

    // Every key the snapshot claims, answered from the one layer it has. This is what
    // makes dropping the other one safe: `NamespaceBundle` is total, so there is no gap.
    const bengali = await new StaticContentSource().translator("bn", []);
    for (const key of Object.keys(snapshot.overrides)) {
      expect(bengali.t(key as never)).not.toBe(key);
    }
  });

  it("hands back a Translator over the same snapshot", async () => {
    const t = await new StaticContentSource().translator("bn", []);

    expect(t.locale).toBe("bn");
    expect(t.t("error.forbidden")).toBe("এটি করার অনুমতি আপনার নেই।");
  });

  // Unchanged by dropping the layer, and the reason the layer was not what made a
  // partial load work: a key outside the loaded namespaces missed both layers before.
  it("returns a key from an unloaded namespace verbatim", async () => {
    const t = await new StaticContentSource().translator("bn", []);

    expect(t.t("nav.signOut")).toBe("nav.signOut");
  });

  // A catalog with no loader for a namespace yields nothing rather than throwing.
  // That is how a client catalog structurally cannot obtain server-only copy.
  it("skips a namespace its catalog cannot serve", async () => {
    const empty = new StaticContentSource({ en: {}, bn: {} });
    const snapshot = await empty.messages("en", ["common"]);

    expect(snapshot.namespaces).toEqual(["common", "error"]);
    expect(snapshot.overrides).toEqual({});
  });
});
