import type { CommentDto } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import { CommentText } from "../../src/comment/index.js";

const ANN = "0190a0b0-0000-7000-8000-000000000001";
const ANN_LEE = "0190a0b0-0000-7000-8000-000000000002";

const comment = (key: string, extra: Partial<CommentDto> = {}): CommentDto =>
  ({
    id: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    target: { kind: "file", key },
    body: "x",
    authorId: ANN,
    authorName: "Ann",
    parentId: null,
    resolvedAt: null,
    pinned: false,
    editedAt: null,
    createdAt: new Date(),
    ...extra,
  }) as CommentDto;

describe("CommentText", () => {
  it("splits a body into text and mentions", () => {
    expect(CommentText.parts(`hi @[${ANN}], see this`)).toEqual([
      { kind: "text", text: "hi " },
      { kind: "mention", userId: ANN },
      { kind: "text", text: ", see this" },
    ]);
  });

  // A shorter name first would turn `@Ann Lee` into Ann's mention followed by " Lee".
  it("encodes the longest chosen name first", () => {
    const chosen = new Map([
      ["Ann", ANN],
      ["Ann Lee", ANN_LEE],
    ]);
    expect(CommentText.encode("@Ann Lee and @Ann", chosen)).toBe(`@[${ANN_LEE}] and @[${ANN}]`);
  });

  it("round-trips through decode for an edit", () => {
    const people = new Map([[ANN, "Ann"]]);
    expect(CommentText.decode(`ping @[${ANN}]`, people)).toBe("ping @Ann");
  });

  it("reads the partial name the caret is in, and none outside a mention", () => {
    expect(CommentText.query("hello @an", 9)).toBe("an");
    expect(CommentText.query("hello @", 7)).toBe("");
    expect(CommentText.query("mail a@b", 8)).toBeNull();
    expect(CommentText.query("hello", 5)).toBeNull();
  });

  it("counts open comments per node and every folder above it", () => {
    const marks = CommentText.marks([
      comment("src/a.ts"),
      comment("src/a.ts", { resolvedAt: new Date() }),
      comment("src/b.ts", { pinned: true, resolvedAt: new Date() }),
      comment("", { target: { kind: "project", key: "" } }),
    ]);
    expect(marks.get("src/a.ts")).toEqual({ count: 1, pinned: false });
    expect(marks.get("src/b.ts")).toEqual({ count: 0, pinned: true });
    expect(marks.get("src")).toEqual({ count: 1, pinned: true });
    expect(marks.size).toBe(3);
  });
});
