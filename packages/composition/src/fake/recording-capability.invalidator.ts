import { CapabilityInvalidator, type OrganizationId, type UserId } from "../import.js";

// The flush assertion. An RBAC write that changes what someone may do and does not call
// one of these leaves a revoked permission working for a minute, so this records.
export class RecordingCapabilityInvalidator extends CapabilityInvalidator {
  private readonly entries: string[] = [];
  private platformFlushes = 0;

  public override invalidate(organizationId: OrganizationId, userId: UserId): Promise<void> {
    this.entries.push(`${organizationId}:${userId}`);
    return Promise.resolve();
  }

  public override invalidatePlatform(): Promise<void> {
    this.platformFlushes += 1;
    return Promise.resolve();
  }

  public flushedPlatform(): number {
    return this.platformFlushes;
  }

  public override invalidateOrganization(organizationId: OrganizationId): Promise<void> {
    this.entries.push(organizationId);
    return Promise.resolve();
  }

  public flushed(): readonly string[] {
    return this.entries;
  }

  // Recorded as `*`, so a spec asserts the whole-deployment flush the same way as a tenant.
  public override invalidateAll(): Promise<void> {
    this.entries.push("*");
    return Promise.resolve();
  }
}
