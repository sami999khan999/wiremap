import { describe, expect, it } from "vitest";
import { type MessageSnapshot, Translator } from "../../src/translator/translator.js";

const snapshot = (overrides: Partial<MessageSnapshot> = {}): MessageSnapshot => ({
  locale: "en",
  namespaces: ["common", "error"],
  base: {
    "error.field.required": "{field} is required.",
    "error.field.tooShort": "{field} must be at least {min} characters.",
    "state.loading": "Loading…",
  },
  overrides: {},
  ...overrides,
});

describe("Translator", () => {
  it("interpolates named params", () => {
    const t = new Translator(snapshot());

    expect(t.t("error.field.required", { field: "Email" })).toBe("Email is required.");
    expect(t.t("error.field.tooShort", { field: "Reason", min: 10 })).toBe(
      "Reason must be at least 10 characters.",
    );
  });

  // `"Hello undefined"` reads like a data problem; `"Hello {nmae}"` reads like the bug it is.
  it("leaves an unknown placeholder in place", () => {
    expect(new Translator(snapshot()).t("error.field.required", { fiedl: "Email" })).toBe(
      "{field} is required.",
    );
  });

  it("renders the key itself when nothing is loaded", () => {
    const t = new Translator(snapshot({ base: {}, namespaces: [] }));

    expect(t.t("error.field.required")).toBe("error.field.required");
    expect(t.has("error.field.required")).toBe(false);
    expect(t.loaded("error")).toBe(false);
  });

  it("prefers an override over the English base", () => {
    const t = new Translator(
      snapshot({ locale: "bn", overrides: { "error.field.required": "{field} আবশ্যক।" } }),
    );

    expect(t.t("error.field.required", { field: "ইমেইল" })).toBe("ইমেইল আবশ্যক।");
  });

  it("with() does not mutate the instance it came from", () => {
    const t = new Translator(snapshot());
    const derived = t.with({ "state.loading": "Still loading…" });

    expect(derived.t("state.loading")).toBe("Still loading…");
    expect(t.t("state.loading")).toBe("Loading…");
  });

  it("merge() unions namespaces and both layers", () => {
    const merged = Translator.merge(snapshot({ namespaces: ["common"] }), {
      locale: "en",
      namespaces: ["error"],
      base: { "error.unexpected": "Something went wrong. Please try again." },
      overrides: {},
    });

    expect(merged.namespaces).toEqual(["common", "error"]);
    expect(new Translator(merged).has("error.unexpected")).toBe(true);
  });
});
