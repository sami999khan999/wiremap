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

  it("round-trips the install state, and refuses one that was edited", async () => {
    const url = new URL(await provider().installUrl(ORG));
    const state = url.searchParams.get("state") ?? "";

    expect(url.pathname).toBe("/apps/wiremap-test/installations/new");
    expect(await provider().organizationFromState(state)).toBe(ORG);
    expect(
      await provider().organizationFromState(state.replace(ORG, ORG.replace(/1$/, "2"))),
    ).toBeNull();
    expect(await provider().organizationFromState("garbage")).toBeNull();
  });

  it("verifies a webhook signature over the raw body, and nothing else", async () => {
    const body = JSON.stringify({ ref: "refs/heads/main" });
    const good = `sha256=${createHmac("sha256", "hook-secret").update(body).digest("hex")}`;

    expect(await provider().verifyWebhook(body, good)).toBe(true);
    expect(await provider().verifyWebhook(`${body} `, good)).toBe(false);
    expect(await provider().verifyWebhook(body, null)).toBe(false);
    expect(await provider().verifyWebhook(body, "sha256=00")).toBe(false);
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

describe("GithubAppProvider.installationsOfUser", () => {
  const withOauth = (fetcher: typeof fetch) =>
    new GithubAppProvider({
      appId: "1",
      slug: "wiremap-test",
      privateKey: pem,
      webhookSecret: "hook",
      stateSecret: "state",
      oauth: { clientId: "cid", clientSecret: "csecret" },
      fetch: fetcher,
    });

  it("exchanges the code and lists what the person can see, keeping no token", async () => {
    const seen: string[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push(
        `${init?.method ?? "GET"} ${String(url)} ${new Headers(init?.headers).get("authorization") ?? "-"}`,
      );
      if (String(url).endsWith("/login/oauth/access_token")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          client_id: "cid",
          client_secret: "csecret",
          code: "c0de",
        });
        return json({ access_token: "user-token" });
      }
      return json({ installations: [{ id: 9 }, { id: 12 }] });
    }) as typeof fetch;

    expect(await withOauth(fetcher).installationsOfUser("c0de")).toEqual([9, 12]);
    expect(seen).toEqual([
      "POST https://github.com/login/oauth/access_token -",
      "GET https://api.github.com/user/installations?per_page=100&page=1 Bearer user-token",
    ]);
  });

  it("answers null for a refused code, and with no OAuth pair at all", async () => {
    const refused = (async () => json({ error: "bad_verification_code" })) as typeof fetch;
    expect(await withOauth(refused).installationsOfUser("old")).toBeNull();
    expect(await provider().installationsOfUser("c0de")).toBeNull();
  });
});

describe("GithubAppProvider.branchHead", () => {
  const sha = "a".repeat(40);
  const responding = (status: number, body: string) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/access_tokens"))
        return json({ token: "t", expires_at: new Date(Date.now() + 3_600_000).toISOString() });
      if (
        String(url).includes("/installation/repositories") ||
        (String(url).includes("/repos/acme/api") && !String(url).includes("/commits/"))
      )
        return json({ id: 1, full_name: "acme/api", default_branch: "main", private: true });
      expect(new Headers(init?.headers).get("accept")).toBe("application/vnd.github.sha");
      return new Response(body, { status });
    }) as typeof fetch;

  it("reads the head commit as a bare sha", async () => {
    expect(await provider(responding(200, `${sha}\n`)).branchHead(9, "acme/api", "main")).toBe(sha);
  });

  it("answers null for a branch that is gone", async () => {
    expect(await provider(responding(404, "")).branchHead(9, "acme/api", "old")).toBeNull();
  });
});
