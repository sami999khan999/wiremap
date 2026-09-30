import {
  ERROR_CATALOG,
  type ErrorCode,
  ErrorNormalizer,
  ServerOnlyError,
  ValidationError,
} from "@loadbearing/errors";
import { describe, expect, it } from "vitest";
import { ERROR_COPY, ErrorCopy, FIELD_RULE_COPY } from "../../src/message/error-copy.js";
import { StaticContentSource } from "../../src/source/static-content.source.js";

const translator = (locale: "en" | "bn" = "en") => new StaticContentSource().translator(locale, []);

describe("ERROR_COPY", () => {
  // The compiler already makes this total, but a code with no copy reaches a customer as
  // a raw `SERVER_ONLY` on screen — worth a runtime assertion too.
  it("covers every error code", () => {
    for (const code of Object.keys(ERROR_CATALOG) as ErrorCode[]) {
      expect(ERROR_COPY[code], code).toBeTypeOf("string");
    }

    expect(Object.keys(ERROR_COPY).sort()).toEqual(Object.keys(ERROR_CATALOG).sort());
  });

  // Every value has to be a shell key: one pointed at a lazy namespace renders as its own
  // raw key on any route that did not declare it.
  it("resolves for every code against a snapshot that asked for nothing", async () => {
    const t = await translator();

    for (const code of Object.keys(ERROR_CATALOG) as ErrorCode[]) {
      const key = ERROR_COPY[code];
      expect(t.has(key), `${code} → ${key}`).toBe(true);
    }
  });
});

describe("FIELD_RULE_COPY", () => {
  // Open by necessity, but it must cover every rule `ValidationError` can emit.
  it("covers every rule ValidationError produces", () => {
    const issues = [
      { path: ["a"], code: "invalid_type" },
      { path: ["b"], code: "too_small", minimum: 10 },
      { path: ["c"], code: "too_big", maximum: 5 },
      { path: ["d"], code: "invalid_format" },
      { path: ["e"], code: "not_a_zod_code_we_know" },
    ];

    for (const violation of ValidationError.fromIssues(issues).fields ?? []) {
      expect(FIELD_RULE_COPY[violation.rule], violation.rule).toBeTypeOf("string");
    }
  });
});

describe("ErrorCopy", () => {
  it("renders a code with no context", async () => {
    const t = await translator();

    expect(ErrorCopy.message(t, { code: "FORBIDDEN", context: {} })).toBe(
      "You do not have permission to do that.",
    );
  });

  // The end-to-end split: `core` throws, `errors` carries the code and `{ package }`,
  // and this package supplies the words.
  it("renders the sentence ServerOnly.assert used to carry inline", async () => {
    const t = await translator();
    const envelope = new ServerOnlyError("@loadbearing/infrastructure").toJSON();

    expect(ErrorCopy.message(t, envelope)).toBe(
      "@loadbearing/infrastructure was imported into a client bundle. This is a leak, not a bundle-size " +
        "problem — it means database or credential code is reachable from the browser.",
    );
  });

  it("interpolates a boolean context value without complaint", async () => {
    const t = await translator();
    const rendered = ErrorCopy.message(t, {
      code: "UNAVAILABLE",
      context: { retried: true, attempts: 3 },
    });

    expect(rendered).toBe("Something went wrong. Please try again.");
  });

  it("names the field in a violation sentence", async () => {
    const t = await translator();
    const envelope = ValidationError.fromIssues([
      { path: ["reason"], code: "too_small", minimum: 10 },
    ]).toJSON();

    expect(ErrorCopy.fields(t, envelope)).toEqual(["reason must be at least 10 characters."]);
  });

  // The regression guard: every `error.field.*` template opens with `{field}`, so a
  // violation naming none rendered as " is not valid." — a sentence starting on a space.
  it("falls back rather than opening a sentence on a space", async () => {
    const t = await translator();
    const rendered = ErrorCopy.field(t, { field: "", rule: "invalid" });

    expect(rendered).toBe("Something went wrong. Please try again.");
    expect(rendered.startsWith(" ")).toBe(false);
  });

  it("falls back for a rule it has never heard of", async () => {
    const t = await translator();
    const rendered = ErrorCopy.field(t, { field: "email", rule: "notInTheMap" });

    expect(rendered).toBe("Something went wrong. Please try again.");
  });

  // A rule arrives in the envelope from outside, and the fallback was an index and a
  // `??`: `FIELD_RULE_COPY["toString"]` is a truthy function, so this rendered nothing.
  it.each(["toString", "constructor", "valueOf", "hasOwnProperty"])(
    "falls back for the inherited name %s rather than rendering an empty sentence",
    async (rule) => {
      const t = await translator();
      const rendered = ErrorCopy.field(t, { field: "email", rule });

      expect(rendered).toBe("Something went wrong. Please try again.");
    },
  );

  it("returns no field sentences for an error that has no violations", async () => {
    const t = await translator();

    expect(ErrorCopy.fields(t, { code: "INTERNAL", context: {} })).toEqual([]);
  });

  // An anonymised internal error still gets words, and never the original's words.
  it("renders a normalised unknown throw", async () => {
    const t = await translator();
    const envelope = ErrorNormalizer.normalize(
      new Error("connection to db-prod-01 refused"),
    ).toJSON();

    expect(ErrorCopy.message(t, envelope)).toBe("Something went wrong. Please try again.");
  });

  it("renders in the requested locale", async () => {
    const t = await translator("bn");

    expect(ErrorCopy.message(t, { code: "FORBIDDEN", context: {} })).toBe(
      "এটি করার অনুমতি আপনার নেই।",
    );
    // Every code, not a sample: `ERROR_COPY` is total over `ERROR_CATALOG` and every
    // bundle is total over its namespace, so no code may render an English sentence.
    for (const code of Object.keys(ERROR_CATALOG) as ErrorCode[]) {
      expect(ErrorCopy.message(t, { code, context: {} })).not.toMatch(/^[\p{ASCII}]+$/u);
    }
  });
});
