import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountClient } from "../../src/auth/account.client.js";
import { AuthClient } from "../../src/auth/auth.client.js";

// The same double the other client specs use: Better Auth's client is driven entirely by
// `fetch`, so a stub of that is the whole harness.
type Reply = { status?: number; body?: unknown };

function clientOver(replies: Record<string, Reply>) {
  const calls: { path: string; body: unknown }[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: { body?: string }) => {
      const path = new URL(String(input)).pathname.replace("/api/auth", "");
      calls.push({ path, body: init?.body ? JSON.parse(init.body) : undefined });

      const reply = replies[path] ?? { status: 200, body: {} };
      // `?? {}` would turn a deliberate `null` body into an object, and the two are
      // different answers: one is "no data", the other is "data with nothing in it".
      return new Response(JSON.stringify("body" in reply ? reply.body : {}), {
        status: reply.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );

  const auth = new AuthClient({ baseUrl: "https://example.test/api/auth" });
  return { account: new AccountClient(auth), calls };
}

const bodyOf = (calls: { path: string; body: unknown }[], path: string) =>
  calls.find((call) => call.path === path)?.body;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AccountClient — credentials", () => {
  // Not optional, and not a default worth trusting: changing a password because someone
  // else may know it, and leaving their session alive, is the failure this prevents.
  it("revokes other sessions on every password change", async () => {
    const { account, calls } = clientOver({});

    await account.changePassword("old-one", "new-one");

    expect(bodyOf(calls, "/change-password")).toEqual({
      currentPassword: "old-one",
      newPassword: "new-one",
      revokeOtherSessions: true,
    });
  });

  it("sends the change of address with the callback the caller chose", async () => {
    const { account, calls } = clientOver({});

    await account.changeEmail("new@example.test", "https://example.test/settings");

    expect(bodyOf(calls, "/change-email")).toEqual({
      newEmail: "new@example.test",
      callbackURL: "https://example.test/settings",
    });
  });

  it("normalises a refusal into this repository's error rather than Better Auth's", async () => {
    const { account } = clientOver({
      "/change-password": { status: 400, body: { code: "INVALID_PASSWORD" } },
    });

    await expect(account.changePassword("wrong", "new-one")).rejects.toMatchObject({
      message: expect.stringMatching(/^[A-Z_]+$/),
    });
  });
});

describe("AccountClient — two-factor", () => {
  // `totpURI` off the wire, `totpUri` here: the casing is Better Auth's and the rename
  // is the reason this method exists rather than the raw client being handed out.
  it("renames the enrolment payload and carries the codes through", async () => {
    const { account, calls } = clientOver({
      "/two-factor/enable": {
        body: { totpURI: "otpauth://totp/x", backupCodes: ["a", "b"] },
      },
    });

    const enrolment = await account.enableTwoFactor("secret");

    expect(enrolment).toEqual({ totpUri: "otpauth://totp/x", backupCodes: ["a", "b"] });
    // The password stops a stolen session enrolling its own authenticator.
    expect(bodyOf(calls, "/two-factor/enable")).toEqual({ password: "secret" });
  });

  it("refuses an enrolment the server answered with no body", async () => {
    const { account } = clientOver({ "/two-factor/enable": { body: null } });

    await expect(account.enableTwoFactor("secret")).rejects.toThrow();
  });

  it("returns the regenerated codes, which invalidate every earlier one", async () => {
    const { account } = clientOver({
      "/two-factor/generate-backup-codes": { body: { backupCodes: ["c", "d"] } },
    });

    expect(await account.regenerateBackupCodes("secret")).toEqual(["c", "d"]);
  });
});

describe("AccountClient — linked accounts", () => {
  // A `Date` dehydrates to a string and rehydrates as one, so the type would be a lie on
  // the second render. Normalised here, once.
  it("hands back ISO strings rather than whatever shape the wire carried", async () => {
    const { account } = clientOver({
      "/list-accounts": {
        body: [
          {
            id: "1",
            providerId: "credential",
            accountId: "u1",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    });

    expect(await account.listAccounts()).toEqual([
      {
        id: "1",
        providerId: "credential",
        accountId: "u1",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });
});

describe("AccountClient — sessions", () => {
  const listed = [
    { id: "1", token: "here", createdAt: "2026-01-01T00:00:00.000Z", userAgent: "Firefox" },
    { id: "2", token: "there", createdAt: "2026-01-02T00:00:00.000Z", ipAddress: "10.0.0.1" },
  ];

  // Two calls, because the endpoint flags nothing and the cookie holding the current
  // token is httpOnly: this is the only place the two can be compared.
  it("marks exactly the session this tab is holding", async () => {
    const { account } = clientOver({
      "/list-sessions": { body: listed },
      "/get-session": { body: { session: { token: "there" } } },
    });

    const sessions = await account.listSessions();

    expect(sessions.map((session) => session.current)).toEqual([false, true]);
    expect(sessions[0]?.userAgent).toBe("Firefox");
    // Absent, not undefined: the list renders the pair and `undefined` would print.
    expect(sessions[0]?.ipAddress).toBeNull();
    expect(sessions[1]?.userAgent).toBeNull();
  });

  // `undefined === token` is false for every row, so a session that cannot be resolved
  // marks none rather than marking all of them.
  it("marks none when the current session cannot be resolved", async () => {
    const { account } = clientOver({
      "/list-sessions": { body: listed },
      "/get-session": { body: {} },
    });

    expect((await account.listSessions()).map((session) => session.current)).toEqual([
      false,
      false,
    ]);
  });

  it("revokes one by token, and the rest without naming any", async () => {
    const { account, calls } = clientOver({});

    await account.revokeSession("there");
    await account.revokeOtherSessions();

    expect(bodyOf(calls, "/revoke-session")).toEqual({ token: "there" });
    expect(calls.some((call) => call.path === "/revoke-other-sessions")).toBe(true);
  });
});
