import {
  Buffer,
  createHmac,
  createSign,
  type OrganizationId,
  type ProviderInstallation,
  type ProviderRepository,
  RepositoryProvider,
  timingSafeEqual,
  UnavailableError,
} from "../import.js";

export interface GithubAppConfig {
  readonly appId: string;
  readonly slug: string;
  // PEM, PKCS#1 or PKCS#8, as GitHub hands it out. `\n` escapes are accepted for env files.
  readonly privateKey: string;
  readonly webhookSecret: string;
  // Signs the install `state`. The auth secret is enough: it never leaves the server.
  readonly stateSecret: string;
  // The App's own OAuth pair: what proves the person installing can see the installation.
  readonly oauth?: { readonly clientId: string; readonly clientSecret: string };
  readonly oauthUrl?: string;
  readonly apiUrl?: string;
  readonly fetch?: typeof fetch;
}

interface RepositoryPayload {
  readonly id: number;
  readonly full_name: string;
  readonly default_branch: string;
  readonly private: boolean;
}

// GitHub through its App over plain `fetch`: no Octokit. Every token is minted per use,
// read-only and never stored. See docs/infra/github-app.md.
export class GithubAppProvider extends RepositoryProvider {
  public override readonly configured = true;

  private static readonly PAGE = 100;
  // GitHub refuses a JWT living longer than ten minutes; one minute of skew is allowed.
  private static readonly JWT_TTL_SECONDS = 540;
  private static readonly STATE_TTL_MS = 60 * 60 * 1000;

  private readonly api: string;
  private readonly http: typeof fetch;
  private readonly key: string;

  public constructor(private readonly config: GithubAppConfig) {
    super();
    this.api = config.apiUrl ?? "https://api.github.com";
    this.http = config.fetch ?? fetch;
    this.key = config.privateKey.replaceAll("\\n", "\n");
  }

  public override installUrl(organizationId: OrganizationId): string {
    const state = encodeURIComponent(this.signState(organizationId, Date.now()));
    return `https://github.com/apps/${this.config.slug}/installations/new?state=${state}`;
  }

  public override organizationFromState(state: string): OrganizationId | null {
    const [organizationId, issued, mac] = state.split(".");
    if (!organizationId || !issued || !mac) return null;
    const at = Number(issued);
    if (!Number.isSafeInteger(at) || Date.now() - at > GithubAppProvider.STATE_TTL_MS) return null;
    return GithubAppProvider.same(this.signState(organizationId as OrganizationId, at), state)
      ? (organizationId as OrganizationId)
      : null;
  }

  public override async installation(installationId: number): Promise<ProviderInstallation | null> {
    const response = await this.asApp(`/app/installations/${installationId}`);
    if (response.status === 404) return null;
    const body = (await this.json(response)) as { id: number; account: { login: string } | null };
    return { installationId: body.id, accountLogin: body.account?.login ?? "" };
  }

  // The user token lives for this call alone: exchanged, used for one listing, dropped.
  public override async installationsOfUser(code: string): Promise<readonly number[] | null> {
    const oauth = this.config.oauth;
    if (!oauth) return null;
    const exchange = await this.http(
      `${this.config.oauthUrl ?? "https://github.com"}/login/oauth/access_token`,
      {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          client_id: oauth.clientId,
          client_secret: oauth.clientSecret,
          code,
        }),
      },
    );
    const token = ((await exchange.json().catch(() => ({}))) as { access_token?: unknown })
      .access_token;
    if (!exchange.ok || typeof token !== "string") return null;
    const ids: number[] = [];
    for (let page = 1; ; page += 1) {
      const response = await this.http(
        `${this.api}/user/installations?per_page=${GithubAppProvider.PAGE}&page=${page}`,
        {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
          },
        },
      );
      if (!response.ok) return null;
      const body = (await response.json()) as { installations: { id: number }[] };
      ids.push(...body.installations.map((installation) => installation.id));
      if (body.installations.length < GithubAppProvider.PAGE) return ids;
    }
  }

  public override async repositories(
    installationId: number,
  ): Promise<readonly ProviderRepository[]> {
    const token = await this.installationToken(installationId);
    const out: ProviderRepository[] = [];
    for (let page = 1; ; page += 1) {
      const response = await this.asInstallation(
        token,
        `/installation/repositories?per_page=${GithubAppProvider.PAGE}&page=${page}`,
      );
      const body = (await this.json(response)) as { repositories: RepositoryPayload[] };
      for (const repository of body.repositories)
        out.push(GithubAppProvider.repository(repository));
      if (body.repositories.length < GithubAppProvider.PAGE) return out;
    }
  }

  public override async branches(
    installationId: number,
    fullName: string,
  ): Promise<readonly string[]> {
    const { token } = await this.readToken(installationId, fullName);
    const out: string[] = [];
    for (let page = 1; ; page += 1) {
      const response = await this.asInstallation(
        token,
        `/repos/${fullName}/branches?per_page=${GithubAppProvider.PAGE}&page=${page}`,
      );
      const body = (await this.json(response)) as { name: string }[];
      for (const branch of body) out.push(branch.name);
      if (body.length < GithubAppProvider.PAGE) return out;
    }
  }

  // Narrowed to one repository and `contents: read`, whatever the App itself was granted.
  public override async readToken(
    installationId: number,
    fullName: string,
  ): Promise<{ readonly token: string; readonly expiresAt: Date }> {
    const name = fullName.split("/")[1] ?? fullName;
    return this.mint(installationId, { repositories: [name], permissions: { contents: "read" } });
  }

  public override async fileAt(
    installationId: number,
    fullName: string,
    ref: string,
    path: string,
  ): Promise<string | null> {
    // The path comes from an uploaded graph: a `..` segment would walk the API URL out of
    // the repository's contents, since `fetch` resolves it before sending.
    const segments = path.split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
      return null;
    }
    const { token } = await this.readToken(installationId, fullName);
    const response = await this.http(
      `${this.api}/repos/${fullName}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
      {
        headers: { ...GithubAppProvider.headers(token), accept: "application/vnd.github.raw+json" },
      },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new UnavailableError("github.contents", response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A NUL in the first 8 KB is how git itself decides a file is binary.
    if (bytes.subarray(0, 8192).includes(0)) return null;
    return new TextDecoder().decode(bytes);
  }

  // `X-Hub-Signature-256`, compared in constant time over the raw body.
  public override verifyWebhook(body: string, signature: string | null): boolean {
    if (!signature) return false;
    const expected = `sha256=${createHmac("sha256", this.config.webhookSecret).update(body).digest("hex")}`;
    return GithubAppProvider.same(expected, signature);
  }

  // Exposed for the spec: an RS256 JWT signed with the App's key.
  public appJwt(now: number): string {
    const seconds = Math.floor(now / 1000);
    const header = GithubAppProvider.base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = GithubAppProvider.base64url(
      JSON.stringify({
        iat: seconds - 60,
        exp: seconds + GithubAppProvider.JWT_TTL_SECONDS,
        iss: this.config.appId,
      }),
    );
    const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(this.key);
    return `${header}.${payload}.${GithubAppProvider.base64url(signature)}`;
  }

  private async installationToken(installationId: number): Promise<string> {
    return (
      await this.mint(installationId, { permissions: { contents: "read", metadata: "read" } })
    ).token;
  }

  private async mint(
    installationId: number,
    scope: Record<string, unknown>,
  ): Promise<{ readonly token: string; readonly expiresAt: Date }> {
    const response = await this.asApp(`/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      body: JSON.stringify(scope),
    });
    const body = (await this.json(response)) as { token: string; expires_at: string };
    return { token: body.token, expiresAt: new Date(body.expires_at) };
  }

  private asApp(path: string, init: RequestInit = {}): Promise<Response> {
    return this.http(`${this.api}${path}`, {
      ...init,
      headers: GithubAppProvider.headers(this.appJwt(Date.now())),
    });
  }

  private asInstallation(token: string, path: string): Promise<Response> {
    return this.http(`${this.api}${path}`, { headers: GithubAppProvider.headers(token) });
  }

  // UNAVAILABLE, retryable: a GitHub blip should not dead-letter a scan.
  private async json(response: Response): Promise<unknown> {
    if (!response.ok) throw new UnavailableError("github", response.status);
    return response.json();
  }

  private signState(organizationId: OrganizationId, at: number): string {
    const mac = createHmac("sha256", this.config.stateSecret)
      .update(`github-install.${organizationId}.${at}`)
      .digest("base64url");
    return `${organizationId}.${at}.${mac}`;
  }

  private static headers(token: string): Record<string, string> {
    return {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "wiremap",
    };
  }

  private static repository(payload: RepositoryPayload): ProviderRepository {
    return {
      externalId: String(payload.id),
      fullName: payload.full_name,
      defaultBranch: payload.default_branch,
      private: payload.private,
    };
  }

  private static same(expected: string, actual: string): boolean {
    const left = Buffer.from(expected);
    const right = Buffer.from(actual);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private static base64url(value: string | Buffer): string {
    return Buffer.from(value).toString("base64url");
  }
}
