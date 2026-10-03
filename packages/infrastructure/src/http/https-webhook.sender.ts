import {
  createHmac,
  httpsRequest,
  isIP,
  type LookupAddress,
  lookup,
  type WebhookRequest,
  type WebhookResponse,
  WebhookSender,
} from "../import.js";

// One POST: the status, or a throw when nothing answered. Swapped for a fake in specs.
export type WebhookPost = (
  url: URL,
  headers: Readonly<Record<string, string>>,
  body: string,
) => Promise<number>;

type Resolve = (host: string) => Promise<readonly string[]>;

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

// The connection's own lookup refuses a non-public answer, so a name that resolves one
// way for the check and another for the connection still never reaches inside.
const guardedLookup = (
  hostname: string,
  options: { readonly all?: boolean },
  callback: (error: Error | null, address: string | LookupAddress[], family?: number) => void,
) => {
  lookup(hostname, { all: true })
    .then((addresses) => {
      if (
        addresses.length === 0 ||
        !addresses.every((each) => HttpsWebhookSender.publicAddress(each.address))
      )
        throw new Error(`${hostname} resolves to a non-public address`);
      const first = addresses[0] as LookupAddress;
      if (options.all) callback(null, addresses);
      else callback(null, first.address, first.family);
    })
    .catch((error: Error) => callback(error, ""));
};

const httpsPost: WebhookPost = (url, headers, body) =>
  new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      { method: "POST", headers, lookup: guardedLookup, timeout: TIMEOUT_MS },
      (response) => {
        // The body is never read: nothing in it is used, and a large one would hold the job.
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on("timeout", () => request.destroy(new Error("timed out")));
    request.on("error", reject);
    request.end(body);
  });

// Posts a delivery with an HMAC over `timestamp.body`, to a public address only. Redirects
// are not followed, since `https.request` follows none: a 3xx counts as a failure.
export class HttpsWebhookSender extends WebhookSender {
  public constructor(
    private readonly post: WebhookPost = httpsPost,
    private readonly resolve: Resolve = async (host) =>
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
    // Checked here as well as at connect time: an address literal skips the lookup hook.
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
      const status = await this.post(url, headers, request.body);
      return { ok: status >= 200 && status < 300, status };
    } catch {
      return { ok: false, status: null };
    }
  }

  private async isPublic(hostname: string): Promise<boolean> {
    const host = hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) ? [host] : await this.resolve(host).catch(() => []);
    return (
      addresses.length > 0 &&
      addresses.every((address) => HttpsWebhookSender.publicAddress(address))
    );
  }

  public static publicAddress(address: string): boolean {
    if (isIP(address) === 4) return HttpsWebhookSender.publicV4(address.split(".").map(Number));
    const words = HttpsWebhookSender.v6Words(address);
    if (!words) return false;
    const [w0 = 0, w1 = 0, w2 = 0, w3 = 0, , w5 = 0, w6 = 0, w7 = 0] = words;
    const tail = [w6 >> 8, w6 & 0xff, w7 >> 8, w7 & 0xff];
    const zeroTo = (end: number) => words.slice(0, end).every((word) => word === 0);
    // IPv4 inside IPv6 is judged as the IPv4 it carries: mapped (::ffff:a.b.c.d),
    // compatible (::a.b.c.d), NAT64 (64:ff9b::/96) and 6to4 (2002:AABB:CCDD::).
    if (zeroTo(5) && w5 === 0xffff) return HttpsWebhookSender.publicV4(tail);
    if (zeroTo(6)) return !(w6 === 0 && w7 <= 1) && HttpsWebhookSender.publicV4(tail);
    if (w0 === 0x64 && w1 === 0xff9b) return HttpsWebhookSender.publicV4(tail);
    if (w0 === 0x2002) return HttpsWebhookSender.publicV4([w1 >> 8, w1 & 0xff, w2 >> 8, w2 & 0xff]);
    // Unique local fc00::/7, link-local fe80::/10, multicast ff00::/8, Teredo 2001::/32
    // (which hides an IPv4 too), documentation 2001:db8::/32, discard 100::/64.
    if ((w0 & 0xfe00) === 0xfc00 || (w0 & 0xffc0) === 0xfe80 || (w0 & 0xff00) === 0xff00)
      return false;
    if (w0 === 0x2001 && (w1 === 0 || w1 === 0xdb8)) return false;
    if (w0 === 0x100 && w1 === 0 && w2 === 0 && w3 === 0) return false;
    return true;
  }

  private static publicV4(octets: readonly number[]): boolean {
    const [a = 0, b = 0] = octets;
    const value = (a << 8) | b;
    return !BLOCKED_V4.some(([first, second, bits]) => {
      const mask = (0xffff << (16 - bits)) & 0xffff;
      return (value & mask) === (((first << 8) | second) & mask);
    });
  }

  // Eight 16-bit words, with `::` expanded and a dotted IPv4 tail folded into two words.
  private static v6Words(address: string): number[] | null {
    let text = address.toLowerCase().split("%")[0] ?? "";
    const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
    if (dotted) {
      const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
      text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    }
    const halves = text.split("::");
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(":") : [];
    const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const missing = 8 - head.length - rest.length;
    if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
    const words = [
      ...head,
      ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"),
      ...rest,
    ].map((word) => Number.parseInt(word, 16));
    return words.length === 8 &&
      words.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff)
      ? words
      : null;
  }
}
