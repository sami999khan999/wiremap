import type { UserId } from "@loadbearing/contracts";
import { UnavailableError, ValidationError } from "@loadbearing/errors";
import { describe, expect, it, vi } from "vitest";
import { HttpsGithubAppGateway } from "../../src/github/index.js";

const USER = "0193a8b2-7c00-7000-8000-0000000000a1" as UserId;

const gateway = (fetcher?: typeof fetch) =>
  new HttpsGithubAppGateway({
    stateSecret: "state-secret",
    ...(fetcher ? { fetch: fetcher } : {}),
  });

const stateOf = (action: string) => new URL(action).searchParams.get("state") ?? "";

const json = (body: unknown, status = 201) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const CONVERSION = {
  id: 42,
  slug: "wiremap-abc123",
  html_url: "https://github.com/apps/wiremap-abc123",
  owner: { login: "octo" },
  client_id: "Iv23client",
  client_secret: "client-secret",
  pem: "-----BEGIN RSA PRIVATE KEY-----\n",
  webhook_secret: "hook-secret",
};

describe("HttpsGithubAppGateway", () => {
  it("posts to the person's own settings, or to an organization's", () => {
    expect(gateway().manifestAction(null, USER)).toMatch(
      /^https:\/\/github\.com\/settings\/apps\/new\?state=/,
    );
    expect(gateway().manifestAction("acme", USER)).toMatch(
      /^https:\/\/github\.com\/organizations\/acme\/settings\/apps\/new\?state=/,
    );
  });

  it("round-trips the state, and refuses one edited, foreign or stale", () => {
    const state = stateOf(gateway().manifestAction(null, USER));

    expect(gateway().userFromState(state)).toBe(USER);
    expect(gateway().userFromState(state.replace(USER, USER.replace(/1$/, "2")))).toBeNull();
    expect(
      new HttpsGithubAppGateway({ stateSecret: "another-secret" }).userFromState(state),
    ).toBeNull();
    expect(gateway().userFromState("garbage")).toBeNull();

    vi.useFakeTimers({ now: Date.now() + 61 * 60 * 1000 });
    try {
      expect(gateway().userFromState(state)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("exchanges the code for the App's credentials, unauthenticated", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const credentials = await gateway((url, init) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(json(CONVERSION));
    }).convert("a180b1a3d263c81bc6441d7b990bae27d4c10679");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://api.github.com/app-manifests/a180b1a3d263c81bc6441d7b990bae27d4c10679/conversions",
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.stringify(calls[0]?.init?.headers)).not.toContain("authorization");
    expect(credentials).toEqual({
      appId: "42",
      slug: "wiremap-abc123",
      htmlUrl: "https://github.com/apps/wiremap-abc123",
      ownerLogin: "octo",
      clientId: "Iv23client",
      clientSecret: "client-secret",
      privateKey: "-----BEGIN RSA PRIVATE KEY-----\n",
      webhookSecret: "hook-secret",
    });
  });

  it("makes up a webhook secret when the App has no webhook", async () => {
    const credentials = await gateway(() =>
      Promise.resolve(json({ ...CONVERSION, webhook_secret: null })),
    ).convert("code");
    expect(credentials.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("calls a spent code a validation failure, a GitHub outage unavailable", async () => {
    const fetcher = vi.fn();
    await expect(gateway(fetcher).convert("../../user")).rejects.toBeInstanceOf(ValidationError);
    expect(fetcher).not.toHaveBeenCalled();

    await expect(
      gateway(() => Promise.resolve(json({ message: "Not Found" }, 404))).convert("spent"),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      gateway(() => Promise.resolve(json({}, 502))).convert("code"),
    ).rejects.toBeInstanceOf(UnavailableError);
  });
});
