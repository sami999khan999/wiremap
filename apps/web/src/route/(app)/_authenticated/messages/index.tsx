import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ClientNamespace, ConversationList, useMessages } from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["messaging"] as const satisfies readonly ClientNamespace[];

export const Route = createFileRoute("/(app)/_authenticated/messages/")({
  beforeLoad: RouteGuard.requirePermission("messaging.conversation.read"),
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: Messages,
});

function Messages() {
  const { t } = useMessages("messaging");
  const navigate = useNavigate();

  return (
    <main>
      <h1>{t("messaging.inbox.title")}</h1>
      <ConversationList
        onOpen={(conversationId) =>
          void navigate({
            to: "/messages/$conversationId",
            params: { conversationId },
          })
        }
      />
    </main>
  );
}
