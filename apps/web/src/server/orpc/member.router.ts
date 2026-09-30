import { authed } from "../import.js";

// Three lines per procedure, as `RoleRouter`. `revokeInvitation` is the exception: its
// `{ ok: true }` is the transport's word, not the domain's.
export class MemberRouter {
  private constructor() {}

  public static readonly list = authed.member.list.handler(({ input, context }) =>
    context.container.member.listMembers.execute(context.principal, input),
  );

  public static readonly listInvitations = authed.member.listInvitations.handler(
    ({ input, context }) =>
      context.container.member.listInvitations.execute(context.principal, input),
  );

  public static readonly invite = authed.member.invite.handler(({ input, context }) =>
    context.container.member.inviteMember.execute(context.principal, input),
  );

  public static readonly revokeInvitation = authed.member.revokeInvitation.handler(
    async ({ input, context }) => {
      await context.container.member.revokeInvitation.execute(context.principal, input);
      return { ok: true as const };
    },
  );

  public static readonly resendInvitation = authed.member.resendInvitation.handler(
    ({ input, context }) =>
      context.container.member.resendInvitation.execute(context.principal, input),
  );

  public static readonly changeRole = authed.member.changeRole.handler(({ input, context }) =>
    context.container.member.changeMemberRole.execute(context.principal, input),
  );

  // The boolean is the router's, not the caller's: two procedures carry it in the path
  // so a product can gate them apart without changing a request body.
  public static readonly deactivate = authed.member.deactivate.handler(({ input, context }) =>
    context.container.member.setMemberActive.execute(context.principal, input, false),
  );

  public static readonly reactivate = authed.member.reactivate.handler(({ input, context }) =>
    context.container.member.setMemberActive.execute(context.principal, input, true),
  );

  // The object the merge point in `app.router.ts` mounts, mirroring `MemberProcedures.all`.
  public static readonly all = {
    list: MemberRouter.list,
    listInvitations: MemberRouter.listInvitations,
    invite: MemberRouter.invite,
    revokeInvitation: MemberRouter.revokeInvitation,
    resendInvitation: MemberRouter.resendInvitation,
    changeRole: MemberRouter.changeRole,
    deactivate: MemberRouter.deactivate,
    reactivate: MemberRouter.reactivate,
  } as const;
}
