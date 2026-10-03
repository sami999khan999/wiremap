// The public API at `/api/v1`, by API key: what `login`, `whoami` and `mcp` read.
export class PublicClient {
  public constructor(
    private readonly server: string,
    private readonly apiKey: string,
    private readonly http: typeof fetch = fetch,
  ) {}

  public async get<T>(path: string, query: Record<string, string | undefined> = {}): Promise<T> {
    const url = new URL(`${this.server.replace(/\/+$/, "")}/api/v1${path}`);
    for (const [name, value] of Object.entries(query))
      if (value !== undefined) url.searchParams.set(name, value);
    const response = await this.http(url, { headers: { authorization: `Bearer ${this.apiKey}` } });
    if (response.status === 401 || response.status === 403)
      throw new Error("The server refused the API key. Run `wiremap login` with a valid one.");
    if (response.status === 404) throw new Error(`Not found: ${path}`);
    if (response.status === 429) throw new Error("Too many requests. Wait a minute and retry.");
    if (!response.ok) throw new Error(`The server answered ${response.status} for ${path}.`);
    return (await response.json()) as T;
  }
}
