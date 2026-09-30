import type { OrganizationId, UserId } from "../import.js";

// What one person sees hidden, split by whose choice it was: the admin's is for everyone,
// and only their own can they undo. Strings, because a row can outlive its widget.
export interface WidgetPreferences {
  readonly hiddenByAdmin: readonly string[];
  readonly hiddenByUser: readonly string[];
}

// A row means hidden and no row means shown. `userId` null is the org default.
export abstract class WidgetPreferenceRepository {
  // One read for both halves, because the dashboard needs both before it renders.
  public abstract findFor(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<WidgetPreferences>;

  // Idempotent: hiding what is already hidden writes nothing.
  public abstract save(
    organizationId: OrganizationId,
    userId: UserId | null,
    widget: string,
  ): Promise<void>;

  public abstract delete(
    organizationId: OrganizationId,
    userId: UserId | null,
    widget: string,
  ): Promise<void>;
}
