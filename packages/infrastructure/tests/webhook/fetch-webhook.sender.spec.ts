import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FetchWebhookSender } from "../../src/http/fetch-webhook.sender.js";

const request = (url: string, secret: string | null = "whsec_test") => ({
  url,
  body: '{"event":"scan.failed"}',
  secret,
  event: "scan.failed",
  deliveryId: "d-1",
});

const recorder = (status = 200) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const http = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response("ignored", { status });
  }) as typeof fetch;
  return { calls, http };
};

describe("FetchWebhookSender", () => {
  it("signs `timestamp.body` with the secret, and follows no redirect", async () => {
    const { calls, http } = recorder();
    const sender = new FetchWebhookSender(http, () => Promise.resolve(["93.184.216.34"]));

    expect(await sender.send(request("https://hooks.example.com/x"))).toEqual({
      ok: true,
      status: 200,
    });
    const headers = calls[0]?.init.headers as Record<string, string>;
    const expected = createHmac("sha256", "whsec_test")
      .update(`${headers["x-wiremap-timestamp"]}.{"event":"scan.failed"}`)
      .digest("hex");
    expect(headers["x-wiremap-signature"]).toBe(`sha256=${expected}`);
    expect(headers["x-wiremap-delivery"]).toBe("d-1");
    expect(calls[0]?.init.redirect).toBe("manual");
  });

  it("sends a Slack delivery unsigned, and counts a redirect as a failure", async () => {
    const { calls, http } = recorder(302);
    const sender = new FetchWebhookSender(http, () => Promise.resolve(["93.184.216.34"]));

    expect(await sender.send(request("https://hooks.slack.com/x", null))).toEqual({
      ok: false,
      status: 302,
    });
    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(headers["x-wiremap-signature"]).toBeUndefined();
  });

  // The request starts inside our network, so a name that resolves inward is refused
  // before anything is sent, including the metadata service at 169.254.169.254.
  it("refuses http, private and loopback addresses without sending", async () => {
    const { calls, http } = recorder();
    const inward = new FetchWebhookSender(http, () =>
      Promise.resolve(["93.184.216.34", "10.0.0.5"]),
    );
    const sender = new FetchWebhookSender(http, () => Promise.resolve(["93.184.216.34"]));

    expect(await sender.send(request("http://hooks.example.com/x"))).toEqual({
      ok: false,
      status: null,
    });
    expect(await inward.send(request("https://rebind.example.com/x"))).toEqual({
      ok: false,
      status: null,
    });
    expect(await sender.send(request("https://169.254.169.254/latest"))).toEqual({
      ok: false,
      status: null,
    });
    expect(await sender.send(request("https://[::1]/x"))).toEqual({ ok: false, status: null });
    expect(calls).toHaveLength(0);
  });

  it("knows the public and the private ranges", () => {
    const publicOnes = ["93.184.216.34", "172.32.0.1", "100.128.0.1", "2606:4700::1111"];
    const privateOnes = [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "169.254.169.254",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ];
    expect(publicOnes.filter((address) => !FetchWebhookSender.publicAddress(address))).toEqual([]);
    expect(privateOnes.filter((address) => FetchWebhookSender.publicAddress(address))).toEqual([]);
  });

  it("reports no status when nothing answered", async () => {
    const sender = new FetchWebhookSender(
      () => Promise.reject(new Error("ECONNREFUSED")),
      () => Promise.resolve(["93.184.216.34"]),
    );
    expect(await sender.send(request("https://hooks.example.com/x"))).toEqual({
      ok: false,
      status: null,
    });
  });
});
