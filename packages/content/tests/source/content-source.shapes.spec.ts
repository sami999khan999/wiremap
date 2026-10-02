import { ImageManifest } from "@loadbearing/asset";
import { describe, expect, it } from "vitest";
import { navItems } from "../../src/collection/index.js";
import { SERVER_CATALOG } from "../../src/message/index.js";
import { StaticContentSource } from "../../src/source/static-content.source.js";

const source = new StaticContentSource();

describe("lazy namespaces", () => {
  it("loads a namespace a route declares, alongside the shell", async () => {
    const snapshot = await source.messages("en", ["auth"]);

    expect(snapshot.namespaces).toEqual(["common", "error", "auth"]);
    expect(snapshot.overrides["auth.signIn"]).toBe("Sign in");
  });

  it("does not load a namespace nobody asked for", async () => {
    const snapshot = await source.messages("en", ["auth"]);

    expect(snapshot.namespaces).not.toContain("nav");
    expect(snapshot.overrides["nav.roles"]).toBeUndefined();
  });

  // The right failure mode: `nav.roles` on screen names the exact string to grep for,
  // and the bug is a route that forgot to declare a namespace.
  it("renders the key itself for an undeclared namespace", async () => {
    const t = await source.translator("en", []);

    expect(t.t("nav.roles")).toBe("nav.roles");
    expect(t.loaded("nav")).toBe(false);
  });
});

describe("the other three shapes", () => {
  it("resolves media through the manifest", async () => {
    expect(await source.media("brand.logo")).toEqual(ImageManifest.get("brand.logo"));
  });

  it("hands back the nav collection", async () => {
    expect(await source.nav()).toEqual(navItems);
  });

  // Not a stub that throws: the shape exists to come from a database, and a missing slug
  // is a 404.
});

// Tested against the two real catalogs rather than a hand-built empty one.
describe("the server-only email namespace", () => {
  const server = new StaticContentSource(SERVER_CATALOG);

  it("serves email copy from the server catalog", async () => {
    const t = await server.translator("en", ["email"]);

    expect(t.t("email.digest.subject", { count: 3 })).toBe("Your daily digest — 3 updates");
  });

  it("still carries the shell, so an escalation notice already has error copy", async () => {
    const snapshot = await server.messages("en", ["email"]);

    expect(snapshot.namespaces).toEqual(["common", "error", "email"]);
    expect(snapshot.overrides["error.conflict"]).toBeDefined();
  });

  // A client catalog has no email loader, so the lookup is skipped and `t()` renders the
  // key: a browser cannot obtain email copy by asking.
  it("yields nothing when a client source is asked for it by name", async () => {
    const t = await source.translator("en", ["email"]);

    expect(t.t("email.digest.subject", { count: 3 })).toBe("email.digest.subject");
  });
});
