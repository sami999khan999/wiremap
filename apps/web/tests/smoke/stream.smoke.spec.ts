import { describe, expect, inject, it } from "vitest";
import { SMOKE_DOMAIN } from "./support/server.js";
import type {} from "./support/stack.js";

const baseUrl = inject("baseUrl");
const { mailpitUrl } = inject("smoke");

// One address per run, so a crashed run cannot collide with the next and the sweep has
// something to match on.
const address = () => `stream-${Date.now()}-${Math.random().toString(16).slice(2)}@${SMOKE_DOMAIN}`;

const PASSWORD = "web-smoke-password-2026";

interface Mail {
  readonly ID: string;
}

const json = async (response: Response): Promise<unknown> => {
  if (!response.ok) throw new Error(`${response.url} answered ${response.status}`);
  return response.json();
};

// Polls rather than sleeps: the mail is a queue job, so how long it takes is the
// worker's business and a fixed wait is either a flake or a slow suite.
async function waitForMail(to: string): Promise<string> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const found = (await json(
      await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`),
    )) as { messages?: readonly Mail[] };

    const id = found.messages?.[0]?.ID;
    if (id) {
      const message = (await json(await fetch(`${mailpitUrl}/api/v1/message/${id}`))) as {
        Text?: string;
        HTML?: string;
      };
      const body = `${message.Text ?? ""} ${message.HTML ?? ""}`;
      const link = body.match(/https?:\/\/[^\s"'<>]*verify-email[^\s"'<>]*/)?.[0];
      if (link) return link.replaceAll("&amp;", "&");
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`no verification mail for ${to} within 30s`);
}

// The whole point of this suite: a signed-in HTTP client, an open stream, and a frame
// that arrives on it because a *different* request caused one.
async function readFrame(body: ReadableStream<Uint8Array>, until: number): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let seen = "";

  try {
    while (Date.now() < until) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += decoder.decode(value, { stream: true });
      if (seen.includes("member.changed")) return seen;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return seen;
}

describe("the built server, end to end over HTTP", () => {
  it("delivers a realtime frame to a client that is holding the stream open", async () => {
    const email = address();

    // 1. Sign up. `AUTH_ENROLMENT_MODE=personal`, so this founds an organization and
    //    makes this user its owner — which is what lets step 5 invite anybody.
    await json(
      await fetch(`${baseUrl}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Smoke", email, password: PASSWORD }),
      }),
    );

    // 2. The mail is a job on `QueueName.MAIL`, so this only passes with a worker up.
    const verification = await waitForMail(email);
    const verified = await fetch(verification, { redirect: "follow" });
    expect(verified.status).toBe(200);

    // 3. Sign in and keep the cookie, which is the only thing that makes the stream
    //    below authorised — the channel is built from the principal, never from input.
    const signIn = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(signIn.status).toBe(200);

    const cookie = signIn.headers
      .getSetCookie()
      .map((each) => each.split(";")[0])
      .join("; ");
    expect(cookie).not.toBe("");

    // 4. Open the stream and start reading *before* causing anything: pub/sub has no
    //    replay, so a frame published first is not late, it is gone.
    const stream = await fetch(`${baseUrl}/api/rpc/realtime/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ json: undefined }),
    });
    expect(stream.status).toBe(200);
    expect(stream.body).not.toBeNull();

    const frame = readFrame(stream.body as ReadableStream<Uint8Array>, Date.now() + 20_000);
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 5. A second request, on a different connection, publishing to this user's channel.
    //    An invitation is the cheapest one an owner can cause alone, and its role id
    //    ──
    //    comes from `SystemRoleSeed`, which ran when the organization was founded.
    const roles = (await json(
      await fetch(`${baseUrl}/api/rpc/role/list`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ json: { limit: 25, offset: 0 } }),
      }),
    )) as { json: { items: readonly { id: string; key: string }[] } };

    const member = roles.json.items.find((role) => role.key === "member");
    expect(member, "the founded organization has a `member` role").toBeDefined();

    const invited = await fetch(`${baseUrl}/api/rpc/member/invite`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ json: { email: address(), roleId: member?.id } }),
    });
    expect(invited.status).toBe(200);

    // 6. What nothing else in this repository proves: the frame reached an HTTP client.
    expect(await frame).toContain("member.changed");
  });
});
