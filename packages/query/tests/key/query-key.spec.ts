import { describe, expect, it } from "vitest";
import { QueryKeys } from "../../src/key/query-key.js";

const page = { limit: 20, offset: 0 };
const second = { limit: 20, offset: 20 };

describe("QueryKeys", () => {
  it("mirrors the procedure path, parameters last", () => {
    expect(QueryKeys.rbac.roles(page)).toEqual(["rbac", "role", "list", page]);
    expect(QueryKeys.rbac.effective("u1")).toEqual(["rbac", "effective", "u1"]);
    expect(QueryKeys.member.list(page)).toEqual(["member", "list", page]);
    expect(QueryKeys.member.invitations(page)).toEqual(["member", "invitation", "list", page]);
  });

  // The regression guard: these three took no argument while the fetch beside them
  // passed `params`, so page 2 rendered page 1 out of cache.
  it("gives two pages of one list two different keys", () => {
    expect(QueryKeys.member.list(page)).not.toEqual(QueryKeys.member.list(second));
    expect(QueryKeys.member.invitations(page)).not.toEqual(QueryKeys.member.invitations(second));
    expect(QueryKeys.rbac.roles(page)).not.toEqual(QueryKeys.rbac.roles(second));
  });

  // TanStack matches by prefix, so `all()` catching everything below it is the property
  // that makes a broad invalidation one call rather than a grep for `invalidateQueries`.
  it("makes all() a prefix of every key in its namespace", () => {
    const all = QueryKeys.rbac.all();
    const keys = [QueryKeys.rbac.roles(page), QueryKeys.rbac.effective("u1")];

    for (const key of keys) {
      expect(key.slice(0, all.length)).toEqual([...all]);
    }

    const member = QueryKeys.member.all();
    for (const key of [QueryKeys.member.list(page), QueryKeys.member.invitations(page)]) {
      expect(key.slice(0, member.length)).toEqual([...member]);
    }
  });

  it("keys the session as a bare namespace", () => {
    expect(QueryKeys.session.all()).toEqual(["session"]);
  });

  // Positional parameters shift every key when a filter is added later, which
  // invalidates the whole namespace on deploy. An object does not.
  it("puts parameters in an object rather than spreading them", () => {
    const key = QueryKeys.rbac.effective("u1");

    expect(key).toHaveLength(3);
    expect(typeof key[2]).toBe("string");

    expect(QueryKeys.member.list(page)).toHaveLength(3);
    expect(QueryKeys.member.list(page).at(-1)).toBe(page);
  });
});
