import { generateKeyPairSync } from "node:crypto";
import type { OrganizationId } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import { StoredGithubAppProvider } from "../../src/github/index.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const ORG = "0193a8b2-7c00-7000-8000-000000000001" as OrganizationId;

const RECORD = {
  appId: "42",
  slug: "wiremap-abc123",
  htmlUrl: "https://github.com/apps/wiremap-abc123",
  ownerLogin: "octo",
  clientId: "Iv23client",
  encryptedPrivateKey: `enc:${pem}`,
  encryptedWebhookSecret: "enc:hook-secret",
  encryptedClientSecret: "enc:client-secret",
};

const cipher = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ""),
};

const setup = () => {
  const apps = {
    record: null as typeof RECORD | null,
    reads: 0,
    find() {
      this.reads += 1;
      return Promise.resolve(this.record);
    },
    save: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  };
  const provider = new StoredGithubAppProvider(apps, cipher, { stateSecret: "state-secret" });
  return { apps, provider };
};

describe("StoredGithubAppProvider", () => {
  it("is unconfigured until an App is saved, then picks it up without a restart", async () => {
    const { apps, provider } = setup();

    expect(await provider.isConfigured()).toBe(false);
    expect(await provider.installUrl(ORG)).toBeNull();
    expect(await provider.verifyWebhook("{}", "sha256=00")).toBe(false);

    apps.record = RECORD;
    expect(await provider.isConfigured()).toBe(true);
    const url = new URL((await provider.installUrl(ORG)) ?? "");
    expect(url.pathname).toBe("/apps/wiremap-abc123/installations/new");
    expect(await provider.organizationFromState(url.searchParams.get("state") ?? "")).toBe(ORG);
  });

  it("asks again on every call while there is none, and holds a found App", async () => {
    const { apps, provider } = setup();
    await provider.isConfigured();
    await provider.isConfigured();
    expect(apps.reads).toBe(2);

    apps.record = RECORD;
    await provider.isConfigured();
    await provider.installUrl(ORG);
    await provider.isConfigured();
    expect(apps.reads).toBe(3);
  });
});
