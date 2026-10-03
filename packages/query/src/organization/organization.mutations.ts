import type { OrganizationClient, OrganizationSwitch } from "../import.js";
import { useAppMutation } from "../runtime/index.js";

// The three actions that end in a session pointing at a different tenant. None declares
// `invalidates`: the whole cache belongs to the tenant just left.
export class OrganizationMutations {
  private constructor() {}

  public static useSwitch(organization: OrganizationClient, onDone?: () => void) {
    return useAppMutation<OrganizationSwitch, { organizationId: string }>({
      mutationFn: ({ organizationId }) => organization.switch(organizationId),
      onSuccess: onDone,
    });
  }

  public static useCreate(organization: OrganizationClient, onDone?: () => void) {
    return useAppMutation<OrganizationSwitch, { name: string }>({
      mutationFn: ({ name }) => organization.create(name),
      onSuccess: onDone,
    });
  }

  // Wiremap's shareable link: the same rebind as an emailed invitation.
  public static useAcceptInvitationLink(organization: OrganizationClient, onDone?: () => void) {
    return useAppMutation<OrganizationSwitch, { token: string }>({
      mutationFn: ({ token }) => organization.acceptInvitationLink(token),
      onSuccess: onDone,
    });
  }

  public static useAcceptInvitation(organization: OrganizationClient, onDone?: () => void) {
    return useAppMutation<OrganizationSwitch, { token: string }>({
      mutationFn: ({ token }) => organization.acceptInvitation(token),
      onSuccess: onDone,
    });
  }
}
