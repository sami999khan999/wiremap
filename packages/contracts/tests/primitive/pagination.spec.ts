import { describe, expect, it } from "vitest";
import { Pagination } from "../../src/primitive/pagination.js";

describe("Pagination", () => {
  it("defaults limit and offset", () => {
    expect(Pagination.query.parse({})).toEqual({ limit: 25, offset: 0 });
  });

  it("caps limit at 100", () => {
    expect(Pagination.query.safeParse({ limit: 100 }).success).toBe(true);
    expect(Pagination.query.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("rejects a non-positive limit and a negative offset", () => {
    expect(Pagination.query.safeParse({ limit: 0 }).success).toBe(false);
    expect(Pagination.query.safeParse({ offset: -1 }).success).toBe(false);
  });

  it("rejects fractional values", () => {
    expect(Pagination.query.safeParse({ limit: 2.5 }).success).toBe(false);
  });
});
