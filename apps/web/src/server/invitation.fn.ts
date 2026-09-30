import { createServerFn } from "@tanstack/react-start";
import { z } from "~/import.js";
import { container } from "./container.js";

// The same three fields `InvitationClaimer.preview` returns, restated so the route
// depends on this file and never on the server graph behind it.
export interface InvitationSnapshot {
  readonly organizationName: string;
  readonly email: string;
  readonly expired: boolean;
}

// No principal, because the person holding the link may have no account yet — the claim
// happens through the auth endpoint. See docs/reference/server-functions.md.
export const fetchInvitation = createServerFn({ method: "GET" })
  .validator(z.object({ token: z.string().min(1).max(128) }))
  .handler(async ({ data }): Promise<InvitationSnapshot | null> => {
    return container.invitationClaimer.preview(data.token);
  });
