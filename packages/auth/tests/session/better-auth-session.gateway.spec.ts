import { describe, expect, it } from "vitest";
import type { AuthInstance } from "../../src/factory/index.js";
import type { UserId } from "../../src/import.js";
import { BetterAuthSessionGateway } from "../../src/session/better-auth-session.gateway.js";

const USER = "018f8c00-0000-7000-8000-000000000001" as UserId;

describe("BetterAuthSessionGateway", () => {
  // The adapter method, not a delete on the table: only it also clears the Redis copy
  // that keeps a revoked session answering until its TTL.
  it("revokes through Better Auth's adapter, for that user only", async () => {
    const deleted: string[] = [];
    const auth = {
      $context: Promise.resolve({
        internalAdapter: {
          deleteUserSessions: (userId: string) => {
            deleted.push(userId);
            return Promise.resolve();
          },
        },
      }),
    } as unknown as AuthInstance;

    await new BetterAuthSessionGateway(auth).revokeAll(USER);

    expect(deleted).toEqual([USER]);
  });
});
