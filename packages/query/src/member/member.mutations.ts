import type {
  ApiClient,
  ChangeMemberRoleInput,
  InvitationDto,
  InviteMemberInput,
  MemberDto,
  PaginationQuery,
  ResendInvitationInput,
  RevokeInvitationInput,
  SetMemberActiveInput,
} from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

// Derived, never restated: the envelope is inferred per procedure, and a local interface
// that drifted from it would be written back into the cache by `setQueryData`.
type InvitationPage = Awaited<ReturnType<ApiClient["member"]["listInvitations"]>>;

// Static hook factories: the hook rules apply at the call site, and each is called
// unconditionally at the top of a component.
export class MemberMutations {
  private constructor() {}

  // The whole namespace, not just the invitation list: a re-invite replaces a pending row
  // and the member list sits beside it, so both refetch together.
  public static useInvite(client: ApiClient) {
    return useAppMutation<InvitationDto, InviteMemberInput>({
      mutationFn: (input) => client.member.invite(input),
      invalidates: [QueryKeys.member.all()],
    });
  }

  // Takes the page it is revoking from, because that is what names the cache entry: an
  // optimistic edit has to know which list the row is on, and the list is paginated.
  public static useRevokeInvitation(client: ApiClient, params: PaginationQuery) {
    return useAppMutation<{ ok: true }, RevokeInvitationInput, InvitationPage>({
      mutationFn: (input) => client.member.revokeInvitation(input),
      invalidates: [QueryKeys.member.all()],
      optimistic: {
        queryKey: QueryKeys.member.invitations(params),
        apply: (page, { invitationId }) => ({
          ...page,
          items: page.items.filter((invitation) => invitation.id !== invitationId),
          // Kept in step, or the row count under a list that just shrank is wrong until
          // the refetch lands — which is the moment the optimistic edit exists to cover.
          total: Math.max(0, page.total - 1),
        }),
      },
    });
  }

  // Invalidates rather than edits optimistically: what changes is the expiry, and a row
  // showing a new date before the server agreed is a date nobody can act on.
  public static useResendInvitation(client: ApiClient) {
    return useAppMutation<InvitationDto, ResendInvitationInput>({
      mutationFn: (input) => client.member.resendInvitation(input),
      invalidates: [QueryKeys.member.all()],
    });
  }

  // `rbac.all()` too: the effective-permission key is per user, and a role change is
  // the write that changes what it answers.
  public static useChangeRole(client: ApiClient) {
    return useAppMutation<MemberDto, ChangeMemberRoleInput>({
      mutationFn: (input) => client.member.changeRole(input),
      invalidates: [QueryKeys.member.all(), QueryKeys.rbac.all()],
    });
  }

  public static useDeactivate(client: ApiClient) {
    return useAppMutation<MemberDto, SetMemberActiveInput>({
      mutationFn: (input) => client.member.deactivate(input),
      invalidates: [QueryKeys.member.all()],
    });
  }

  public static useReactivate(client: ApiClient) {
    return useAppMutation<MemberDto, SetMemberActiveInput>({
      mutationFn: (input) => client.member.reactivate(input),
      invalidates: [QueryKeys.member.all()],
    });
  }
}
