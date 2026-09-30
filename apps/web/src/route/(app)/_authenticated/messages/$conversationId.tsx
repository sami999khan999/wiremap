import { createFileRoute } from "@tanstack/react-router";
import {
  type ClientNamespace,
  ConversationEntity,
  MessageComposer,
  MessageList,
  MessagingQueries,
  TypingNotice,
  useApiClient,
  useAppQuery,
  useConversationStream,
  useMemo,
  useMessages,
  useSession,
} from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["messaging"] as const satisfies readonly ClientNamespace[];

// Membership is checked again in every procedure this page calls. The permission gets
// you to the page; it does not get you into the room.
export const Route = createFileRoute("/(app)/_authenticated/messages/$conversationId")({
  beforeLoad: RouteGuard.requirePermission("messaging.conversation.read"),
  staticData: { messages: MESSAGES },
  // The conversation beside the copy, because its members carry every name on this page
  // — the heading, the author lines and the typing notice.
  loader: ({ context, params }) =>
    Promise.all([
      context.messages.ensure(MESSAGES),
      context.queryClient.ensureQueryData(
        MessagingQueries.conversation(context.api, params.conversationId),
      ),
    ]),
  component: Conversation,
});

function Conversation() {
  const { conversationId } = Route.useParams();
  const { t } = useMessages("messaging");
  const client = useApiClient();
  const { user } = useSession();

  const conversation = useAppQuery(MessagingQueries.conversation(client, conversationId));

  // The second stream, open only while this page is. It owns the typing map and
  // invalidates this conversation's pages; the user stream keeps the inbox in order.
  const { typing } = useConversationStream(client, conversationId, user?.id);

  // Once per fetch, not per render: `from` parses, and the typing map changes on every
  // keystroke somebody else makes.
  const entity = useMemo(
    () => (conversation.data ? ConversationEntity.from(conversation.data) : null),
    [conversation.data],
  );

  const nameFor = (userId: string) => entity?.nameOf(userId) ?? null;

  return (
    <main>
      <h1>{entity?.displayTitle(user?.id ?? "") ?? t("messaging.inbox.title")}</h1>
      <MessageList conversationId={conversationId} nameFor={nameFor} />
      <TypingNotice typing={typing} nameFor={nameFor} />
      <MessageComposer conversationId={conversationId} />
    </main>
  );
}
