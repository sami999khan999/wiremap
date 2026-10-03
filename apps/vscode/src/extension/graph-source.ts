import { GraphContract, type GraphDocument, gunzipSync, nodePath, readFile } from "../import.js";

export interface SourceSettings {
  readonly workspaceRoot: string;
  readonly graphFile: string;
  readonly server: string;
  readonly project: string;
  readonly apiKey: string | null;
}

export type Loaded =
  | { readonly document: GraphDocument; readonly origin: string }
  | { readonly missing: string };

// Where the graph comes from: a file `wiremap analyze` wrote, else the project's latest
// scan through the public API. The file wins, so a local branch is read as it is.
export class GraphSource {
  public constructor(private readonly http: typeof fetch = fetch) {}

  public async load(settings: SourceSettings): Promise<Loaded> {
    const file = nodePath.resolve(settings.workspaceRoot, settings.graphFile);
    const local = await readFile(file).catch(() => null);
    if (local) {
      const text = (file.endsWith(".gz") ? gunzipSync(local) : local).toString("utf8");
      return { document: GraphContract.document.parse(JSON.parse(text)), origin: file };
    }
    if (!settings.server || !settings.project)
      return { missing: "no graph file, and no wiremap.server and wiremap.project set" };
    if (!settings.apiKey) return { missing: "no API key: run “wiremap: Set API key”" };
    return {
      document: await this.remote(settings),
      origin: `${settings.project} on ${settings.server}`,
    };
  }

  private async remote(settings: SourceSettings): Promise<GraphDocument> {
    const base = `${settings.server.replace(/\/+$/, "")}/api/v1`;
    const get = async <T>(path: string): Promise<T> => {
      const response = await this.http(`${base}${path}`, {
        headers: { authorization: `Bearer ${settings.apiKey}` },
      });
      if (!response.ok) throw new Error(`wiremap answered ${response.status} for ${path}`);
      return (await response.json()) as T;
    };
    const project = await get<{ id: string }>(
      `/projects/by-slug/${encodeURIComponent(settings.project)}`,
    );
    const link = await get<{ url: string }>(`/projects/${project.id}/graph`);
    const response = await this.http(link.url);
    if (!response.ok) throw new Error(`The graph download failed (${response.status}).`);
    const raw = gunzipSync(new Uint8Array(await response.arrayBuffer()));
    return GraphContract.document.parse(JSON.parse(raw.toString("utf8")));
  }
}
