import { InternalError } from "../import.js";
import type { AuthClient, BetterAuthClient } from "./auth.client.js";
import { BetterAuthErrorNormalizer } from "./better-auth-error-normalizer.js";

// What the three organization endpoints answer with.
export interface OrganizationSwitch {
  readonly organizationId: string;
}

// The three ways a session ends up pointing at a different tenant, over Better Auth's
// own transport because the cookie they re-issue rides the same response.
export class OrganizationClient {
  private readonly client: BetterAuthClient;

  public constructor(auth: AuthClient) {
    this.client = auth.raw;
  }

  // Resolves once row, Redis copy and cookie cache all name the new tenant. The caller
  // still clears its own caches: every cached row belongs to the tenant being left.
  public switch(organizationId: string): Promise<OrganizationSwitch> {
    return this.post("/organization/switch", { organizationId });
  }

  public create(name: string): Promise<OrganizationSwitch> {
    return this.post("/organization/create", { name });
  }

  public acceptInvitation(token: string): Promise<OrganizationSwitch> {
    return this.post("/invitation/accept", { token });
  }

  // `$fetch` rather than a generated method: the plugin has no client half, on
  // purpose — three thin posts do not earn a second plugin to keep in step.
  private async post(path: string, body: Record<string, string>): Promise<OrganizationSwitch> {
    const response = await this.client.$fetch(path, { method: "POST", body });
    if (response.error) throw BetterAuthErrorNormalizer.normalize(response.error);

    // Narrowed by shape, not by a generic on `$fetch`: the guard is what keeps a changed
    // plugin from becoming a silently wrong `organizationId` downstream.
    const data: unknown = response.data;
    if (!OrganizationClient.isSwitch(data)) throw new InternalError();
    return data;
  }

  private static isSwitch(value: unknown): value is OrganizationSwitch {
    return (
      typeof value === "object" &&
      value !== null &&
      typeof (value as { organizationId?: unknown }).organizationId === "string"
    );
  }
}
