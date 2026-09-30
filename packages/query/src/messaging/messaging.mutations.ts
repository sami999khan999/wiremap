import type {
  ApiClient,
  ConversationMemberInput,
  CreateConversationInput,
  DeleteMessageInput,
  EditMessageInput,
  LeaveConversationInput,
  MarkConversationReadInput,
  SendMessageInput,
  TypingInput,
} from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

type Message = Awaited<ReturnType<ApiClient["message"]["send"]>>;
type Page = Awaited<ReturnType<ApiClient["message"]["list"]>>;
type Pages = { readonly pages: readonly Page[]; readonly pageParams: readonly unknown[] };

export class MessagingMutations {
  private constructor() {}

  // Optimistic on the newest page, keyed by the `clientId` the caller generated. The
  // stream replaces the drawn row by that key rather than guessing which one arrived.
  public static useSend(client: ApiClient, conversationId: string) {
    return useAppMutation<Message, SendMessageInput, Pages>({
      mutationFn: (input) => client.message.send(input),
      // The conversation list too: a send moves this room to the top of it.
      invalidates: [QueryKeys.conversation.all()],
      optimistic: {
        queryKey: QueryKeys.message.list(conversationId),
        apply: (cached, input) => ({
          ...cached,
          pages: cached.pages.map((page, index) =>
            index === 0
              ? { ...page, items: [MessagingMutations.pending(input), ...page.items] }
              : page,
          ),
        }),
      },
    });
  }

  public static useEdit(client: ApiClient) {
    return useAppMutation<Message, EditMessageInput>({
      mutationFn: (input) => client.message.edit(input),
      invalidates: [QueryKeys.message.all()],
    });
  }

  public static useDelete(client: ApiClient) {
    return useAppMutation<{ ok: true }, DeleteMessageInput>({
      mutationFn: (input) => client.message.remove(input),
      invalidates: [QueryKeys.message.all()],
    });
  }

  // Optimistic on the list rather than the conversation: the badge going to zero is what
  // opening a room is judged by, and the room itself is already on screen.
  public static useMarkRead(client: ApiClient) {
    return useAppMutation<{ ok: true }, MarkConversationReadInput>({
      mutationFn: (input) => client.conversation.markRead(input),
      invalidates: [QueryKeys.conversation.all()],
    });
  }

  public static useCreateConversation(client: ApiClient) {
    return useAppMutation<
      Awaited<ReturnType<ApiClient["conversation"]["create"]>>,
      CreateConversationInput
    >({
      mutationFn: (input) => client.conversation.create(input),
      invalidates: [QueryKeys.conversation.all()],
    });
  }

  public static useAddMember(client: ApiClient) {
    return useAppMutation<{ ok: true }, ConversationMemberInput>({
      mutationFn: (input) => client.conversation.addMember(input),
      invalidates: [QueryKeys.conversation.all()],
    });
  }

  public static useLeave(client: ApiClient) {
    return useAppMutation<{ ok: true }, LeaveConversationInput>({
      mutationFn: (input) => client.conversation.leave(input),
      invalidates: [QueryKeys.conversation.all()],
    });
  }

  // No invalidation and no optimism: it changes nothing here, and the composer throttles
  // it so this is called at most once every two seconds anyway.
  public static useStartTyping(client: ApiClient) {
    return useAppMutation<{ ok: true }, TypingInput>({
      mutationFn: (input) => client.message.typing(input),
    });
  }

  // The row drawn before the server has one. `id` is the client id so the key that
  // replaces it and the key that identifies it are the same string.
  private static pending(input: SendMessageInput): Message {
    return {
      id: input.clientId,
      conversationId: input.conversationId,
      authorId: "",
      clientId: input.clientId,
      body: input.body,
      deleted: false,
      editedAt: null,
      createdAt: new Date(),
    } as Message;
  }
}
