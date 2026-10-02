import { createFileRoute } from "@tanstack/react-router";
import { RouteGuard } from "~/route/-guard.js";

// The platform menu's link. Never renders: it forwards to the first page the reader may open.
export const Route = createFileRoute("/(app)/_authenticated/platform/")({
  beforeLoad: RouteGuard.firstPlatformPage(),
});
