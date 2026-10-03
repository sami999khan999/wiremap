import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import type { OrganizationId } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import { GithubAppProvider } from "../../src/github/index.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const ORG = "0193a8b2-7c00-7000-8000-000000000001" as OrganizationId;

const provider = (fetcher?: typeof fetch) =>
  new GithubAppProvider({
    appId: "123",
    slug: "wiremap-test",
    privateKey: pem.replaceAll("\n", "\\n"),
    webhookSecret: "hook-secret",
    stateSecret: "state-secret",
    ...(fetcher ? { fetch: fetcher } : {}),
  });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("GithubAppProvider", () => {
  it("signs an RS256 JWT the App's public key verifies", () => {
    const now = Date.now();
    const [header, payload, signature] = provider().appJwt(now).split(".");

    const verifier = createVerify("RSA-SHA256").update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, Buffer.from(signature ?? "", "base64url"))).toBe(true);
    const claims = JSON.parse(Buffer.from(payload ?? "", "base64url").toString()) as {
      iss: string;
      exp: number;
    };
    expect(claims.iss).toBe("123");
    expect(claims.exp - Math.floor(now / 1000)).toBeLessThanOrEqual(600);
  });

  it("round-trips the install state, and refuses one that was edited", () => {
    const url = new URL(provider().installUrl(ORG));
    const state = url.searchParams.get("state") ?? "";

    expect(url.pathname).toBe("/apps/wiremap-test/installations/new");
    expect(provider().organizationFromState(state)).toBe(ORG);
    expect(provider().organizationFromState(state.replace(ORG, ORG.replace(/1$/, "2")))).toBeNull();
    expect(provider().organizationFromState("garbage")).toBeNull();
  });

  it("verifies a webhook signature over the raw body, and nothing else", () => {
    const body = JSON.stringify({ ref: "refs/heads/main" });
    const good = `sha256=${createHmac("sha256", "hook-secret").update(body).digest("hex")}`;

    expect(provider().verifyWebhook(body, good)).toBe(true);
    expect(provider().verifyWebhook(`${body} `, good)).toBe(false);
    expect(provider().verifyWebhook(body, null)).toBe(false);
    expect(provider().verifyWebhook(body, "sha256=00")).toBe(false);
  });

  it("narrows a read token to one repository, and pages repositories", async () => {
    const calls: { url: string; body: string | undefined }[] = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body as string | undefined });
      if (url.endsWith("/access_tokens")) {
        return json({ token: "t", expires_at: new Date(Date.now() + 3_600_000).toISOString() });
      }
      return json({
        repositories: [{ id: 7, full_name: "acme/api", default_branch: "main", private: true }],
      });
    }) as typeof fetch;

    await provider(fetcher).readToken(9, "acme/api");
    const repositories = await provider(fetcher).repositories(9);

    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      repositories: ["api"],
      permissions: { contents: "read" },
    });
    expect(repositories).toEqual([
      { externalId: "7", fullName: "acme/api", defaultBranch: "main", private: true },
    ]);
  });

  it("reads a text file and returns null for a binary or missing one", async () => {
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/access_tokens")) {
        return json({ token: "t", expires_at: new Date().toISOString() });
      }
      if (url.includes("missing")) return new Response("", { status: 404 });
      if (url.includes("logo.png")) return new Response(new Uint8Array([137, 80, 0, 1]));
      return new Response("export const a = 1;\n");
    }) as typeof fetch;

    expect(await provider(fetcher).fileAt(9, "acme/api", "main", "src/a.ts")).toBe(
      "export const a = 1;\n",
    );
    expect(await provider(fetcher).fileAt(9, "acme/api", "main", "logo.png")).toBeNull();
    expect(await provider(fetcher).fileAt(9, "acme/api", "main", "missing.ts")).toBeNull();
  });
});
