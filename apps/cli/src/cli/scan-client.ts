// The two ways the CLI talks to a wiremap server: the runner protocol, authenticated by a
// scan's own token, and the public procedures, authenticated by an API key.
export interface Checkout {
  readonly repositories: readonly {
    readonly name: string;
    readonly fullName: string;
    readonly ref: string;
    readonly token: string;
  }[];
  readonly ignore: readonly string[];
  readonly tsconfigPath: string | null;
}

export interface Upload {
  readonly ref: string;
  readonly token: string;
  readonly uploadUrl: string;
  readonly completeUrl: string;
}

export class ScanClient {
  public constructor(
    private readonly server: string,
    private readonly http: typeof fetch = fetch,
  ) {}

  public async step<T>(ref: string, token: string, step: string, body: unknown = {}): Promise<T> {
    const response = await this.http(`${this.base()}/api/scan/${ref}/${step}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`The server refused ${step} (${response.status}).`);
    return (await response.json()) as T;
  }

  public async complete(url: string, token: string): Promise<{ readonly state: string }> {
    const response = await this.http(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`The server refused complete (${response.status}).`);
    return (await response.json()) as { state: string };
  }

  public async put(url: string, bytes: Uint8Array): Promise<void> {
    const response = await this.http(url, {
      method: "PUT",
      headers: { "content-type": "application/gzip" },
      body: bytes,
    });
    if (!response.ok) throw new Error(`The graph upload was refused (${response.status}).`);
  }

  public async createUpload(
    apiKey: string,
    input: { project: string; branch: string | null; commitSha: string | null },
  ): Promise<Upload> {
    const response = await this.http(`${this.base()}/api/rpc/scan/createUpload`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ json: input }),
    });
    const body = (await response.json().catch(() => null)) as {
      json?: Upload & { message?: string };
    } | null;
    if (!response.ok || !body?.json?.uploadUrl) {
      throw new Error(
        `The server refused the upload (${response.status}${body?.json?.message ? `: ${body.json.message}` : ""}).`,
      );
    }
    return body.json;
  }

  private base(): string {
    return this.server.replace(/\/+$/, "");
  }
}
