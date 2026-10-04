import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Page } from "~/import.js";

// Every settings link lives in the app sidebar, so this layout only sets the column: settings
// pages are forms, and a form reads best narrow.
export const Route = createFileRoute("/(app)/_authenticated/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <Page width="narrow">
      <Outlet />
    </Page>
  );
}
