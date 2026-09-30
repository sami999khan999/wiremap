import { authed } from "../import.js";

// Two groups, mounted under `conversation` and `message` so a procedure path mirrors its
// permission. Nothing here names a member: the channel is the actor's own membership.
export class ConversationRouter {
  private constructor() {}

  public static readonly list = authed.conversation.list.handler(({ input, context }) =>
    context.container.messaging.listConversations.execute(context.principal, input),
  );

  public static readonly create = authed.conversation.create.handler(({ input, context }) =>
    context.container.messaging.createConversation.execute(context.principal, input),
  );

  public static readonly get = authed.conversation.get.handler(({ input, context }) =>
    context.container.messaging.getConversation.execute(context.principal, input.conversationId),
  );

  public static readonly addMember = authed.conversation.addMember.handler(
    async ({ input, context }) => {
      await context.container.messaging.addMember.execute(context.principal, input);
      return { ok: true as const };
    },
  );

  public static readonly removeMember = authed.conversation.removeMember.handler(
    async ({ input, context }) => {
      await context.container.messaging.removeMember.execute(context.principal, input);
      return { ok: true as const };
    },
  );

  public static readonly leave = authed.conversation.leave.handler(async ({ input, context }) => {
    await context.container.messaging.leave.execute(context.principal, input);
    return { ok: true as const };
  });

  public static readonly rename = authed.conversation.rename.handler(async ({ input, context }) => {
    await context.container.messaging.rename.execute(context.principal, input);
    return { ok: true as const };
  });

  public static readonly markRead = authed.conversation.markRead.handler(
    async ({ input, context }) => {
      await context.container.messaging.markRead.execute(context.principal, input);
      return { ok: true as const };
    },
  );

  public static readonly all = {
    list: ConversationRouter.list,
    create: ConversationRouter.create,
    get: ConversationRouter.get,
    addMember: ConversationRouter.addMember,
    removeMember: ConversationRouter.removeMember,
    leave: ConversationRouter.leave,
    rename: ConversationRouter.rename,
    markRead: ConversationRouter.markRead,
  };
}
