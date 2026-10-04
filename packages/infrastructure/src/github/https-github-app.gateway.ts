import {
  Buffer,
  createHmac,
  type GithubAppCredentials,
  GithubAppGateway,
  randomBytes,
  timingSafeEqual,
  UnavailableError,
  type UserId,
  ValidationError,
} from "../import.js";

export interface HttpsGithubAppGatewayConfig {
  // Signs the `state` that rides through GitHub and back. The auth secret is enough.
  readonly stateSecret: string;
  readonly webUrl?: string;
  readonly apiUrl?: string;
  readonly fetch?: typeof fetch;
}

interface ConversionPayload {
  readonly id: number;
  readonly slug: string;
  readonly html_url: string;
  readonly owner: { readonly login?: string } | null;
  readonly client_id: string;
  readonly client_secret: string;
  readonly pem: string;
  readonly webhook_secret: string | null;
}

// GitHub's App Manifest flow over plain `fetch`. The conversion needs no credential: the
// one-time code is the credential, and it lives an hour.
export class HttpsGithubAppGateway extends GithubAppGateway {
  private static readonly STATE_TTL_MS = 60 * 60 * 1000;

  private readonly web: string;
  private readonly api: string;
  private readonly http: typeof fetch;

  public constructor(private readonly config: HttpsGithubAppGatewayConfig) {
    super();
    this.web = config.webUrl ?? "https://github.com";
    this.api = config.apiUrl ?? "https://api.github.com";
    this.http = config.fetch ?? fetch;
  }

  public override manifestAction(organization: string | null, userId: UserId): string {
    const state = encodeURIComponent(this.sign(userId, Date.now()));
    const path = organization
      ? `/organizations/${encodeURIComponent(organization)}/settings/apps/new`
      : "/settings/apps/new";
    return `${this.web}${path}?state=${state}`;
  }

  // Split from the right: the user id is the auth library's, and nothing promises no dot.
  public override userFromState(state: string): UserId | null {
    const macAt = state.lastIndexOf(".");
    const issuedAt = state.lastIndexOf(".", macAt - 1);
    if (issuedAt <= 0 || macAt <= issuedAt) return null;
    const userId = state.slice(0, issuedAt) as UserId;
    const at = Number(state.slice(issuedAt + 1, macAt));
    if (!Number.isSafeInteger(at) || Date.now() - at > HttpsGithubAppGateway.STATE_TTL_MS) {
      return null;
    }
    return HttpsGithubAppGateway.same(this.sign(userId, at), state) ? userId : null;
  }

  public override async convert(code: string): Promise<GithubAppCredentials> {
    // The code arrives as a query parameter and goes into a URL path.
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(code)) {
      throw new ValidationError([{ field: "code", rule: "format" }]);
    }
    const response = await this.http(`${this.api}/app-manifests/${code}/conversions`, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "wiremap",
      },
    });
    // Spent or older than an hour: starting again is the only way forward.
    if (response.status === 404 || response.status === 422) {
      throw new ValidationError([{ field: "code", rule: "expired" }]);
    }
    if (!response.ok) throw new UnavailableError("github.manifest", response.status);
    const body = (await response.json()) as ConversionPayload;
    return {
      appId: String(body.id),
      slug: body.slug,
      htmlUrl: body.html_url,
      ownerLogin: body.owner?.login ?? "",
      clientId: body.client_id,
      clientSecret: body.client_secret,
      privateKey: body.pem,
      // Null when the App was made without a webhook. The provider still needs one to hold.
      webhookSecret: body.webhook_secret ?? randomBytes(32).toString("hex"),
    };
  }

  private sign(userId: UserId, at: number): string {
    const mac = createHmac("sha256", this.config.stateSecret)
      .update(`github-manifest.${userId}.${at}`)
      .digest("base64url");
    return `${userId}.${at}.${mac}`;
  }

  private static same(expected: string, actual: string): boolean {
    const left = Buffer.from(expected);
    const right = Buffer.from(actual);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
