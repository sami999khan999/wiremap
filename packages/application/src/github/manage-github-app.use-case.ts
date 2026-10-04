import { type Clock, ConflictError, ForbiddenError } from "../import.js";
import type { ActivityLogger, SecretCipher, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { GithubAppGateway } from "./github-app.gateway.js";
import type { GithubAppRepository } from "./github-app.repository.js";

export interface GithubAppSettings {
  // Where people reach this deployment. The App's homepage and callbacks are made from it.
  readonly publicUrl: string;
  // An App given in the environment. It wins, and this screen then only shows it.
  readonly environment: { readonly slug: string } | null;
  // False with no encryption key: the App's private key would be stored in the clear.
  readonly encryption: boolean;
}

export interface GithubAppView {
  readonly source: "none" | "environment" | "stored";
  readonly slug: string | null;
  readonly htmlUrl: string | null;
  readonly ownerLogin: string | null;
  readonly publicUrl: string;
  readonly webhooks: boolean;
  readonly canCreate: boolean;
}

// The deployment's GitHub App, made in one click through GitHub's manifest flow: wiremap
// describes the App, GitHub creates it, and the keys come back here encrypted.
export class ManageGithubAppUseCase {
  private static readonly PERMISSION = "platform.github.manage";

  public constructor(
    private readonly authorizer: Authorizer,
    private readonly apps: GithubAppRepository,
    private readonly gateway: GithubAppGateway,
    private readonly cipher: SecretCipher,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly settings: GithubAppSettings,
  ) {}

  public async get(actor: Principal): Promise<GithubAppView> {
    this.authorizer.assert(actor, ManageGithubAppUseCase.PERMISSION);
    const base = {
      publicUrl: this.settings.publicUrl,
      webhooks: ManageGithubAppUseCase.reachable(this.settings.publicUrl),
    };
    const environment = this.settings.environment;
    if (environment) {
      return {
        ...base,
        source: "environment",
        slug: environment.slug,
        htmlUrl: `https://github.com/apps/${environment.slug}`,
        ownerLogin: null,
        canCreate: false,
      };
    }
    const stored = await this.apps.find();
    return stored
      ? {
          ...base,
          source: "stored",
          slug: stored.slug,
          htmlUrl: stored.htmlUrl,
          ownerLogin: stored.ownerLogin,
          canCreate: false,
        }
      : {
          ...base,
          source: "none",
          slug: null,
          htmlUrl: null,
          ownerLogin: null,
          canCreate: this.settings.encryption,
        };
  }

  // The form the browser posts to GitHub. GitHub shows the App with every field filled in,
  // lets the person rename it, and sends them back to `/api/github/manifest`.
  public async start(
    actor: Principal,
    input: {
      readonly organization?: string | undefined;
      readonly anyAccount?: boolean | undefined;
    },
  ): Promise<{ readonly action: string; readonly manifest: string }> {
    this.authorizer.assert(actor, ManageGithubAppUseCase.PERMISSION);
    await this.assertCreatable();
    return {
      action: this.gateway.manifestAction(input.organization ?? null, actor.userId),
      manifest: JSON.stringify(this.manifest(input.anyAccount ?? false)),
    };
  }

  public async complete(
    actor: Principal,
    input: { readonly code: string; readonly state: string },
  ): Promise<void> {
    this.authorizer.assert(actor, ManageGithubAppUseCase.PERMISSION);
    // A state signed for someone else is a creation link replayed: storing it would hand
    // this deployment's repositories to an App another person owns on GitHub.
    if (this.gateway.userFromState(input.state) !== actor.userId) {
      throw new ForbiddenError(ManageGithubAppUseCase.PERMISSION);
    }
    await this.assertCreatable();
    const app = await this.gateway.convert(input.code);
    await this.unitOfWork.run(async () => {
      await this.apps.save({
        appId: app.appId,
        slug: app.slug,
        htmlUrl: app.htmlUrl,
        ownerLogin: app.ownerLogin,
        clientId: app.clientId,
        encryptedPrivateKey: this.cipher.encrypt(app.privateKey),
        encryptedWebhookSecret: this.cipher.encrypt(app.webhookSecret),
        encryptedClientSecret: this.cipher.encrypt(app.clientSecret),
      });
      await this.activity.record(actor, "github.app.created", {
        appId: app.appId,
        slug: app.slug,
      });
    });
  }

  // Forgets the App here. It stays on GitHub, where its owner deletes it.
  public async remove(actor: Principal): Promise<void> {
    this.authorizer.assert(actor, ManageGithubAppUseCase.PERMISSION);
    const stored = await this.apps.find();
    if (!stored) return;
    await this.unitOfWork.run(async () => {
      await this.apps.delete();
      await this.activity.record(actor, "github.app.removed", {
        appId: stored.appId,
        slug: stored.slug,
      });
    });
  }

  private async assertCreatable(): Promise<void> {
    if (this.settings.environment) throw new ConflictError("githubApp", "environment");
    if (!this.settings.encryption) throw new ConflictError("githubApp", "encryption");
    if (await this.apps.find()) throw new ConflictError("githubApp", "exists");
  }

  // Read-only, and the two callbacks in the order the setup route depends on: GitHub sends
  // the installer to the first one. See docs/infra/github-app.md.
  private manifest(anyAccount: boolean): Record<string, unknown> {
    const url = this.settings.publicUrl;
    const webhooks = ManageGithubAppUseCase.reachable(url);
    return {
      // App names are unique across GitHub, so a suffix; GitHub lets the person rename it.
      name: `wiremap-${this.clock.now().getTime().toString(36).slice(-6)}`,
      url,
      description: `Reads repositories for the wiremap at ${url}.`,
      public: anyAccount,
      redirect_url: `${url}/api/github/manifest`,
      callback_urls: [`${url}/api/github/setup`, `${url}/api/auth/callback/github`],
      request_oauth_on_install: true,
      setup_on_update: true,
      default_permissions: { contents: "read", metadata: "read" },
      ...(webhooks
        ? {
            hook_attributes: { url: `${url}/api/github/webhook`, active: true },
            default_events: ["push", "repository"],
          }
        : {}),
    };
  }

  // GitHub delivers webhooks only to a public https address. Anything else polls hourly.
  private static reachable(publicUrl: string): boolean {
    const host = /^https:\/\/([^/:?#]+)/i.exec(publicUrl)?.[1]?.toLowerCase();
    if (!host?.includes(".")) return false;
    return (
      !host.endsWith(".local") &&
      !host.endsWith(".localhost") &&
      !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0)/.test(host)
    );
  }
}
