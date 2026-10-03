import { createHmac } from "node:crypto";
import { type AddressInfo, createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { HttpsWebhookSender, type WebhookPost } from "../../src/http/https-webhook.sender.js";

const request = (url: string, secret: string | null = "whsec_test") => ({
  url,
  body: '{"event":"scan.failed"}',
  secret,
  event: "scan.failed",
  deliveryId: "d-1",
});

const recorder = (status = 200) => {
  const calls: { url: string; headers: Readonly<Record<string, string>> }[] = [];
  const post: WebhookPost = (url, headers) => {
    calls.push({ url: String(url), headers });
    return Promise.resolve(status);
  };
  return { calls, post };
};

const publicDns = () => Promise.resolve(["93.184.216.34"]);

describe("HttpsWebhookSender", () => {
  it("signs `timestamp.body` with the secret", async () => {
    const { calls, post } = recorder();
    const sender = new HttpsWebhookSender(post, publicDns);

    expect(await sender.send(request("https://hooks.example.com/x"))).toEqual({
      ok: true,
      status: 200,
    });
    const headers = calls[0]?.headers ?? {};
    const expected = createHmac("sha256", "whsec_test")
      .update(`${headers["x-wiremap-timestamp"]}.{"event":"scan.failed"}`)
      .digest("hex");
    expect(headers["x-wiremap-signature"]).toBe(`sha256=${expected}`);
    expect(headers["x-wiremap-delivery"]).toBe("d-1");
  });

  it("sends a Slack delivery unsigned, and counts a redirect as a failure", async () => {
    const { calls, post } = recorder(302);
    const sender = new HttpsWebhookSender(post, publicDns);

    expect(await sender.send(request("https://hooks.slack.com/x", null))).toEqual({
      ok: false,
      status: 302,
    });
    expect(calls[0]?.headers["x-wiremap-signature"]).toBeUndefined();
  });

  // The request starts inside our network, so an address that points inward is refused
  // before anything is sent, in every spelling a URL parser produces.
  it("refuses http, private, loopback and IPv4-in-IPv6 addresses without sending", async () => {
    const { calls, post } = recorder();
    const sender = new HttpsWebhookSender(post, publicDns);
    const inward = new HttpsWebhookSender(post, () =>
      Promise.resolve(["93.184.216.34", "10.0.0.5"]),
    );

    expect(await inward.send(request("https://rebind.example.com/x"))).toEqual({
      ok: false,
      status: null,
    });
    for (const url of [
      "http://hooks.example.com/x",
      "https://169.254.169.254/latest",
      "https://[::1]/x",
      "https://[::ffff:127.0.0.1]/x",
      "https://[::ffff:a9fe:a9fe]/x",
      "https://[::7f00:1]/x",
      "https://[64:ff9b::a00:1]/x",
      "https://[2002:c0a8:101::1]/x",
    ]) {
      expect(await sender.send(request(url)), url).toEqual({ ok: false, status: null });
    }
    expect(calls).toHaveLength(0);
  });

  it("knows the public and the private ranges", () => {
    const publicOnes = [
      "93.184.216.34",
      "172.32.0.1",
      "100.128.0.1",
      "2606:4700::1111",
      "::ffff:93.184.216.34",
      "2002:5db8:d822::1",
    ];
    const privateOnes = [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "169.254.169.254",
      "0.0.0.0",
      "::",
      "::1",
      "fd00::1",
      "fe80::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:a9fe:a9fe",
      "::127.0.0.1",
      "64:ff9b::7f00:1",
      "2002:7f00:1::",
      "2001:db8::1",
      "2001:0:4136:e378:8000:63bf:3fff:fdd2",
      "not an address",
    ];
    expect(publicOnes.filter((address) => !HttpsWebhookSender.publicAddress(address))).toEqual([]);
    expect(privateOnes.filter((address) => HttpsWebhookSender.publicAddress(address))).toEqual([]);
  });

  // The check passes on a public answer, then the real connection resolves the name to
  // loopback: the shape of DNS rebinding. The connection's own lookup has to refuse it.
  it("refuses at connect time a name that resolves inward the second time", async () => {
    let connections = 0;
    const listener = createServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
    const { port } = listener.address() as AddressInfo;
    try {
      const sender = new HttpsWebhookSender(undefined, publicDns);
      expect(await sender.send(request(`https://localhost:${port}/x`))).toEqual({
        ok: false,
        status: null,
      });
      // Refused before connecting, not by the listener: nothing ever arrived.
      expect(connections).toBe(0);
    } finally {
      listener.close();
    }
  });

  it("reports no status when nothing answered", async () => {
    const sender = new HttpsWebhookSender(
      () => Promise.reject(new Error("ECONNREFUSED")),
      publicDns,
    );
    expect(await sender.send(request("https://hooks.example.com/x"))).toEqual({
      ok: false,
      status: null,
    });
  });
});
