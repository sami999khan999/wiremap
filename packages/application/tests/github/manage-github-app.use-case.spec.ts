import type { UserId } from "@loadbearing/contracts";
import { ConflictError, ForbiddenError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import {
  type GithubAppCredentials,
  GithubAppGateway,
} from "../../src/github/github-app.gateway.js";
import {
  type GithubAppRecord,
  GithubAppRepository,
} from "../../src/github/github-app.repository.js";
import {
  type GithubAppSettings,
  ManageGithubAppUseCase,
} from "../../src/github/manage-github-app.use-case.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";
import {
  ACTOR,
  CLOCK,
  DirectUnitOfWork,
  ORG,
  OTHER,
  RecordingActivity,
} from "../support/wiremap-fakes.js";

class Apps extends GithubAppRepository {
  public record: GithubAppRecord | null = null;
  public find() {
    return Promise.resolve(this.record);
  }
  public save(record: GithubAppRecord) {
    this.record = record;
    return Promise.resolve();
  }
  public delete() {
    this.record = null;
    return Promise.resolve();
  }
}

// The state is the user id itself, so a spec can forge one for someone else on purpose.
class Gateway extends GithubAppGateway {
  public readonly converted: string[] = [];
  public manifestAction(organization: string | null, userId: UserId) {
    return `https://github.test/${organization ?? "me"}/apps/new?state=${userId}`;
  }
  public userFromState(state: string) {
    return state === "" ? null : (state as UserId);
  }
  public convert(code: string): Promise<GithubAppCredentials> {
    this.converted.push(code);
    return Promise.resolve({
      appId: "42",
      slug: "wiremap-abc123",
      htmlUrl: "https://github.com/apps/wiremap-abc123",
      ownerLogin: "octo",
      clientId: "Iv23client",
      clientSecret: "client-secret",
      privateKey: "-----BEGIN RSA PRIVATE KEY-----",
      webhookSecret: "hook-secret",
    });
  }
}

const cipher = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ""),
};

const actor = (platform: readonly PermissionKey[]) =>
  new Principal(
    ORG,
    ACTOR,
    CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: {},
      platform: { grants: platform, denies: [] },
    }),
  );

const admin = actor(["platform.github.manage"]);

const setup = (settings: Partial<GithubAppSettings> = {}) => {
  const apps = new Apps();
  const gateway = new Gateway();
  const activity = new RecordingActivity();
  const useCase = new ManageGithubAppUseCase(
    new Authorizer(),
    apps,
    gateway,
    cipher,
    activity,
    new DirectUnitOfWork(),
    CLOCK,
    { publicUrl: "http://localhost:43000", environment: null, encryption: true, ...settings },
  );
  return { apps, gateway, activity, useCase };
};

const manifestOf = async (
  useCase: ManageGithubAppUseCase,
  input: { organization?: string; anyAccount?: boolean } = {},
) => {
  const form = await useCase.start(admin, input);
  return { form, manifest: JSON.parse(form.manifest) as Record<string, unknown> };
};

describe("ManageGithubAppUseCase", () => {
  it("is the platform admin's alone", async () => {
    const { useCase } = setup();
    const tenantOwner = actor([]);

    await expect(useCase.get(tenantOwner)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(useCase.start(tenantOwner, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(useCase.remove(tenantOwner)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("describes a read-only App whose installer lands on the setup callback first", async () => {
    const { useCase } = setup();
    const { form, manifest } = await manifestOf(useCase);

    expect(form.action).toBe(`https://github.test/me/apps/new?state=${ACTOR}`);
    expect(manifest).toMatchObject({
      url: "http://localhost:43000",
      public: false,
      redirect_url: "http://localhost:43000/api/github/manifest",
      callback_urls: [
        "http://localhost:43000/api/github/setup",
        "http://localhost:43000/api/auth/callback/github",
      ],
      request_oauth_on_install: true,
      default_permissions: { contents: "read", metadata: "read" },
    });
    expect(String(manifest.name)).toMatch(/^wiremap-[0-9a-z]{1,6}$/);
  });

  it("leaves the webhook out where GitHub cannot reach, and adds it where it can", async () => {
    const local = await manifestOf(setup().useCase);
    expect(local.manifest.hook_attributes).toBeUndefined();
    expect(local.manifest.default_events).toBeUndefined();

    const lan = await manifestOf(setup({ publicUrl: "https://192.168.1.20" }).useCase);
    expect(lan.manifest.hook_attributes).toBeUndefined();

    const reachable = setup({ publicUrl: "https://wiremap.example.com" });
    const { manifest } = await manifestOf(reachable.useCase, {
      organization: "acme",
      anyAccount: true,
    });
    expect(manifest).toMatchObject({
      public: true,
      hook_attributes: { url: "https://wiremap.example.com/api/github/webhook", active: true },
      default_events: ["push", "repository"],
    });
    expect((await reachable.useCase.get(admin)).webhooks).toBe(true);
  });

  it("stores what GitHub returns encrypted, audits it without a secret, and shows it", async () => {
    const { apps, activity, useCase } = setup();

    await useCase.complete(admin, { code: "one-time", state: ACTOR });

    expect(apps.record).toEqual({
      appId: "42",
      slug: "wiremap-abc123",
      htmlUrl: "https://github.com/apps/wiremap-abc123",
      ownerLogin: "octo",
      clientId: "Iv23client",
      encryptedPrivateKey: "enc:-----BEGIN RSA PRIVATE KEY-----",
      encryptedWebhookSecret: "enc:hook-secret",
      encryptedClientSecret: "enc:client-secret",
    });
    expect(activity.records).toEqual([
      { action: "github.app.created", payload: { appId: "42", slug: "wiremap-abc123" } },
    ]);
    expect(await useCase.get(admin)).toMatchObject({
      source: "stored",
      slug: "wiremap-abc123",
      ownerLogin: "octo",
      canCreate: false,
    });
  });

  it("refuses a code returned under someone else's state, before spending it", async () => {
    const { apps, gateway, useCase } = setup();

    await expect(useCase.complete(admin, { code: "stolen", state: OTHER })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(useCase.complete(admin, { code: "stolen", state: "" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(gateway.converted).toEqual([]);
    expect(apps.record).toBeNull();
  });

  it("makes no second App: remove the first, then create again", async () => {
    const { activity, useCase } = setup();
    await useCase.complete(admin, { code: "first", state: ACTOR });

    await expect(useCase.start(admin, {})).rejects.toBeInstanceOf(ConflictError);
    await expect(useCase.complete(admin, { code: "second", state: ACTOR })).rejects.toBeInstanceOf(
      ConflictError,
    );

    await useCase.remove(admin);
    expect(activity.actions()).toEqual(["github.app.created", "github.app.removed"]);
    expect((await useCase.get(admin)).source).toBe("none");
    await expect(useCase.start(admin, {})).resolves.toBeDefined();
  });

  it("defers to an App in the environment, and refuses with no encryption key", async () => {
    const environment = setup({ environment: { slug: "wiremap-env" } }).useCase;
    expect(await environment.get(admin)).toMatchObject({
      source: "environment",
      slug: "wiremap-env",
      htmlUrl: "https://github.com/apps/wiremap-env",
      canCreate: false,
    });
    await expect(environment.start(admin, {})).rejects.toBeInstanceOf(ConflictError);

    const plaintext = setup({ encryption: false }).useCase;
    expect(await plaintext.get(admin)).toMatchObject({ source: "none", canCreate: false });
    await expect(plaintext.start(admin, {})).rejects.toBeInstanceOf(ConflictError);
  });
});
