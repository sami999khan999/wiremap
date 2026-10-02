import { redirect } from "@tanstack/react-router";
import {
  CapabilitySet,
  type CapabilitySetDto,
  type PermissionKey,
  PLATFORM_ROUTE_PERMISSION,
  ROUTES,
  type SessionUser,
} from "~/import.js";

// The third of four enforcement surfaces, and still not the real gate. The leading
// hyphen keeps it out of the route tree. See docs/reference/enforcement-surfaces.md.
export class RouteGuard {
  private constructor() {}

  public static requirePermission(permission: PermissionKey, goalId?: string) {
    return ({ context }: { context: { capabilities: CapabilitySetDto } }): void => {
      // The same `CapabilitySet.can()` the server calls, which is why the DTO is rebuilt
      // rather than shape-checked: a second implementation is a second answer.
      if (!CapabilitySet.from(context.capabilities).can(permission, goalId)) {
        throw redirect({ to: "/forbidden" });
      }
    };
  }

  // `/platform` itself: the first page the reader may open, so a staff role holding one
  // platform key lands on it rather than on a status page it cannot read.
  public static firstPlatformPage() {
    return ({ context }: { context: { capabilities: CapabilitySetDto } }): never => {
      const capabilities = CapabilitySet.from(context.capabilities);
      const page = (
        Object.keys(PLATFORM_ROUTE_PERMISSION) as (keyof typeof PLATFORM_ROUTE_PERMISSION)[]
      ).find((key) => capabilities.can(PLATFORM_ROUTE_PERMISSION[key]));
      throw redirect({ to: page ? ROUTES.platform[page] : "/forbidden" });
    };
  }

  public static requireSession() {
    return ({
      context,
      location,
    }: {
      context: { user: SessionUser | null };
      location: { href: string };
    }): void => {
      // The destination travels, or a deep link lands on `/` after the sign-in it
      // triggered. `href` is path and search, which is the shape `RedirectSearch` accepts.
      if (!context.user) {
        throw redirect({ to: "/sign-in", search: { redirect: location.href } });
      }
    };
  }
}
