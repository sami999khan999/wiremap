import { createFileRoute, redirect } from "@tanstack/react-router";

// `/settings` is a container, not a page: without this it 404s, which is what a reader
// who trims one segment off `/settings/roles` gets.
export const Route = createFileRoute("/(app)/_authenticated/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/account", replace: true });
  },
});
