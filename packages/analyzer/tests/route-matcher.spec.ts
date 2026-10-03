import { describe, expect, it } from "vitest";
import { RouteMatcher } from "../src/match/index.js";
import { RoutePath } from "../src/plugin/index.js";

const call = (url: string, literal = true, based = false) => ({
  line: 1,
  method: "GET" as const,
  url,
  literal,
  based,
});

describe("RoutePath", () => {
  it("reads four parameter syntaxes as one", () => {
    expect(RoutePath.join("api", "/users/{id}/")).toBe("/api/users/:id");
    expect(RoutePath.normalise("/posts/[slug]/[...rest]")).toBe("/posts/:slug/:rest*");
    expect(RoutePath.normalise("/posts/$postId")).toBe("/posts/:postId");
    expect(RoutePath.shape("/users/:id?x=1")).toBe("/users/:param");
  });
});

describe("RouteMatcher", () => {
  const matcher = new RouteMatcher([
    { id: "GET /api/users", method: "GET", path: "/api/users" },
    { id: "GET /api/users/:id", method: "GET", path: "/api/users/:id" },
    { id: "GET /api/users/me", method: "GET", path: "/api/users/me" },
  ]);

  it("prefers the most literal route, and is certain only for a literal whole match", () => {
    expect(matcher.match(call("/api/users/me"))).toMatchObject({
      route: { id: "GET /api/users/me" },
      certain: true,
    });
    expect(matcher.match(call("/api/users/:param", false))).toMatchObject({
      route: { id: "GET /api/users/:id" },
      certain: false,
    });
    expect(matcher.match(call("/users", true, true))).toMatchObject({
      route: { id: "GET /api/users" },
      certain: false,
    });
  });

  it("refuses a match made of parameters alone", () => {
    expect(matcher.match(call("/health"))).toBeNull();
    expect(matcher.match({ ...call("/api/users"), method: "POST" })).toBeNull();
  });
});
