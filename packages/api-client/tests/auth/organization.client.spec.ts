import { describe, expect, it, vi } from "vitest";
import { AuthClient } from "../../src/auth/auth.client.js";
import { OrganizationClient } from "../../src/auth/organization.client.js";

// The same double `auth.client.spec.ts` uses: Better Auth's client is driven entirely
// by `fetch`, so a stub of that is the whole harness.
type Reply = { status?: number; body?: unknown };

function clientOver(replies: readonly Reply[]) {
  const calls: { url: string; method: string | undefined; body: unknown }[] = [];
  let index = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
      const reply = replies[index++] ?? { status: 200, body: {} };
      calls.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(init.body) : undefined,
      });
      return new Response(JSON.stringify(reply.body ?? {}), {
        status: reply.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );

  const auth = new AuthClient({ baseUrl: "https://example.test/api/auth" });
  return { organization: new OrganizationClient(auth), calls };
}

const ORG = "018f8c00-0000-7000-8000-0000000000a1";

describe("OrganizationClient", () => {
  it("posts a switch to the plugin's path and resolves with the tenant", async () => {
    const { organization, calls } = clientOver([{ body: { organizationId: ORG } }]);

    const result = await organization.switch(ORG);

    expect(result).toEqual({ organizationId: ORG });
    expect(calls[0]?.url).toBe("https://example.test/api/auth/organization/switch");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toEqual({ organizationId: ORG });
  });

  it("posts a create and an accept to their own paths", async () => {
    const { organization, calls } = clientOver([
      { body: { organizationId: ORG } },
      { body: { organizationId: ORG } },
    ]);

    await organization.create("Acme");
    await organization.acceptInvitation("tok");

    expect(calls.map((call) => call.url.replace("https://example.test/api/auth", ""))).toEqual([
      "/organization/create",
      "/invitation/accept",
    ]);
    expect(calls[0]?.body).toEqual({ name: "Acme" });
    expect(calls[1]?.body).toEqual({ token: "tok" });
  });

  // The plugin's own codes, mapped onto this repository's closed set so a component can
  // branch on `NOT_FOUND` rather than on a status number or an English sentence.
  it("maps a refused switch to FORBIDDEN and a dead invitation to NOT_FOUND", async () => {
    const { organization } = clientOver([
      { status: 403, body: { code: "NOT_A_MEMBER", message: "no" } },
      { status: 404, body: { code: "INVITATION_NOT_CLAIMABLE", message: "no" } },
    ]);

    await expect(organization.switch(ORG)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(organization.acceptInvitation("tok")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
