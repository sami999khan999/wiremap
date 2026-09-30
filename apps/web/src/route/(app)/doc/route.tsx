import { createFileRoute, Outlet } from "@tanstack/react-router";
import type { ClientNamespace } from "~/import.js";
import { Pending } from "~/route/-boundary.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["doc", "nav"] as const satisfies readonly ClientNamespace[];

// The organization's own docs, outside `_authenticated` on purpose: a docs reader is its
// own full-height screen, and the app header above it would push the sidebar off the fold.
export const Route = createFileRoute("/(app)/doc")({
  beforeLoad: RouteGuard.requireSession(),
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: Outlet,
  pendingComponent: Pending,
});
