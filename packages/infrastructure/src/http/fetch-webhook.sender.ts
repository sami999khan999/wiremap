import {
  createHmac,
  isIP,
  lookup,
  type WebhookRequest,
  type WebhookResponse,
  WebhookSender,
} from "../import.js";

type Lookup = (host: string) => Promise<readonly string[]>;

const TIMEOUT_MS = 10_000;

// Never reached: loopback, private, link-local (the cloud metadata service), carrier NAT,
// multicast. As `[first octet, second octet, prefix bits]`, none longer than /16.
const BLOCKED_V4 = [
  [0, 0, 8],
  [10, 0, 8],
  [100, 64, 10],
  [127, 0, 8],
  [169, 254, 16],
  [172, 16, 12],
  [192, 168, 16],
  [224, 0, 4],
  [240, 0, 4],
] as const;

// Posts a delivery with an HMAC over `timestamp.body`, after checking that the host
// resolves to a public address. Redirects are not followed: a 3xx counts as a failure.
export class FetchWebhookSender extends WebhookSender {
  public constructor(
    private readonly http: typeof fetch = fetch,
    private readonly resolve: Lookup = async (host) =>
      (await lookup(host, { all: true })).map((entry) => entry.address),
  ) {
    super();
  }

  public override async send(request: WebhookRequest): Promise<WebhookResponse> {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return { ok: false, status: null };
    }
    if (url.protocol !== "https:" || !(await this.isPublic(url.hostname))) {
      return { ok: false, status: null };
    }

    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "wiremap-webhooks/1",
      "x-wiremap-event": request.event,
      "x-wiremap-delivery": request.deliveryId,
      "x-wiremap-timestamp": timestamp,
    };
    if (request.secret) {
      const digest = createHmac("sha256", request.secret)
        .update(`${timestamp}.${request.body}`)
        .digest("hex");
      headers["x-wiremap-signature"] = `sha256=${digest}`;
    }

    try {
      const response = await this.http(url, {
        method: "POST",
        headers,
        body: request.body,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // The body is never read: nothing in it is used, and a large one would hold the job.
      await response.body?.cancel();
      return { ok: response.status >= 200 && response.status < 300, status: response.status };
    } catch {
      return { ok: false, status: null };
    }
  }

  // Every address the name resolves to must be public, or one private answer is enough
  // to reach the inside.
  private async isPublic(hostname: string): Promise<boolean> {
    const host = hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) ? [host] : await this.resolve(host).catch(() => []);
    return (
      addresses.length > 0 &&
      addresses.every((address) => FetchWebhookSender.publicAddress(address))
    );
  }

  public static publicAddress(address: string): boolean {
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    const v4 = mapped?.[1] ?? (isIP(address) === 4 ? address : null);
    if (v4) {
      const [a = 0, b = 0] = v4.split(".").map(Number);
      const value = (a << 8) | b;
      return !BLOCKED_V4.some(([first, second, bits]) => {
        const mask = (0xffff << (16 - bits)) & 0xffff;
        return (value & mask) === (((first << 8) | second) & mask);
      });
    }
    const v6 = address.toLowerCase();
    if (v6 === "::" || v6 === "::1") return false;
    // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast.
    return !/^(f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]|ff[0-9a-f]{2}):/.test(v6);
  }
}
