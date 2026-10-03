import type { AuthStrategy } from "../auth/index.js";
import type { AppContract } from "../import.js";
import {
  ClientRetryPlugin,
  type ClientRetryPluginContext,
  type ContractRouterClient,
  createORPCClient,
  InternalError,
  RPCLink,
} from "../import.js";

// Derived from the contract, so a procedure added in `contracts` appears here with no
// edit. The second argument is the retry context — an opt-in knob, defaulting to 0.
export type AppClient = ContractRouterClient<AppContract, ClientRetryPluginContext>;

// What a call site may pass as `context`. Named so the in-process transport can build a
// client with the same one — a narrower client would not be assignable to `AppClient`.
export type AppClientContext = ClientRetryPluginContext;

// `fetch` off `globalThis`, since `lib: ["ES2024"]` declares neither it nor `Request`.
// `unknown` in and `never` out: both flow through untouched, so neither is named.
type FetchLike = (input: unknown, init?: Record<string, unknown>) => Promise<never>;

const platformFetch = (): FetchLike => (globalThis as unknown as { fetch: FetchLike }).fetch;

// Off `globalThis` for the same reason as `fetch`: `lib: ["ES2024"]` declares none of
// these. `window` is the browser test, and its absence is what makes a relative base wrong.
type UrlCtor = { canParse(input: string): boolean };
const platform = () => globalThis as unknown as { URL: UrlCtor; window?: unknown };

export class ApiClient {
  private constructor(private readonly rpc: AppClient) {}

  // Browser, Tauri webview, and any cross-process caller. `streamUrl` is where every
  // `realtime.*` procedure goes — the stream process — and defaults to the one base.
  public static overHttp(baseUrl: string, auth: AuthStrategy, streamUrl = baseUrl): ApiClient {
    ApiClient.assertResolvable(baseUrl);
    ApiClient.assertResolvable(streamUrl);

    const link = new RPCLink({
      // By the first path segment, so one namespace is one process and no list of stream
      // procedures has to be kept in step with the contract.
      url: (_options: unknown, path: readonly string[]) =>
        path[0] === "realtime" ? streamUrl : baseUrl,
      headers: () => auth.headers(),
      // The override exists only to attach `credentials`, which is what decides
      // whether the cookie rides along — and it is per-strategy, not per-call.
      fetch: (request, init) =>
        platformFetch()(request, { ...init, credentials: auth.credentials }),
      // No `default`, so nothing retries unless its call site says so: a mutation that
      // retried itself would submit twice. Streams reconnect in `query`'s `RealtimeStream`.
      plugins: [new ClientRetryPlugin()],
    });

    return new ApiClient(createORPCClient<AppClient>(link));
  }

  // SSR — no network. An HTTP client here would serialise, cross the loopback and
  // deserialise again, twice per loader.
  public static inProcess(rpc: AppClient): ApiClient {
    return new ApiClient(rpc);
  }

  // A relative base is correct in a browser and never correct under Node, where `fetch`
  // has no document to resolve against. See docs/reference/transport.md.
  private static assertResolvable(baseUrl: string): void {
    if (platform().window !== undefined) return;
    if (platform().URL.canParse(baseUrl)) return;

    // The sentence rides on `cause`, which is non-enumerable and reaches the logger
    // without ever reaching the envelope — the code is still the message.
    throw new InternalError(
      new Error(
        `ApiClient.overHttp was given the relative base "${baseUrl}" outside a browser. ` +
          "Under Node it fails at the first call with `Invalid URL`. " +
          "Use ApiClient.inProcess(...) for SSR, or pass an absolute URL.",
      ),
    );
  }

  // One accessor per contract namespace, so the day a namespace needs a wrapper the call
  // sites already go through a method rather than through `raw`.
  public get role(): AppClient["role"] {
    return this.rpc.role;
  }

  public get member(): AppClient["member"] {
    return this.rpc.member;
  }

  public get apiKey(): AppClient["apiKey"] {
    return this.rpc.apiKey;
  }

  public get document(): AppClient["document"] {
    return this.rpc.document;
  }

  public get notification(): AppClient["notification"] {
    return this.rpc.notification;
  }

  public get realtime(): AppClient["realtime"] {
    return this.rpc.realtime;
  }

  public get platform(): AppClient["platform"] {
    return this.rpc.platform;
  }

  public get override(): AppClient["override"] {
    return this.rpc.override;
  }

  public get docSpace(): AppClient["docSpace"] {
    return this.rpc.docSpace;
  }

  public get docPage(): AppClient["docPage"] {
    return this.rpc.docPage;
  }

  public get docGrant(): AppClient["docGrant"] {
    return this.rpc.docGrant;
  }

  public get organization(): AppClient["organization"] {
    return this.rpc.organization;
  }

  public get team(): AppClient["team"] {
    return this.rpc.team;
  }

  public get activity(): AppClient["activity"] {
    return this.rpc.activity;
  }

  public get project(): AppClient["project"] {
    return this.rpc.project;
  }

  public get github(): AppClient["github"] {
    return this.rpc.github;
  }

  public get scan(): AppClient["scan"] {
    return this.rpc.scan;
  }

  public get view(): AppClient["view"] {
    return this.rpc.view;
  }

  public get ask(): AppClient["ask"] {
    return this.rpc.ask;
  }

  public get comment(): AppClient["comment"] {
    return this.rpc.comment;
  }

  // The escape hatch for a namespace with no accessor yet.
  public get raw(): AppClient {
    return this.rpc;
  }
}
