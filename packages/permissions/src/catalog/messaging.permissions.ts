import type { PermissionMeta } from "../registry/index.js";

// A permission is never sufficient here on its own: every use-case also asserts that the
// actor is a member of the conversation. These say what you may do, not what you may see.
export const messagingPermissions = {
  "messaging.conversation.read": {
    scope: "org",
    module: "messaging",
    label: "Read conversations you belong to",
  },
  "messaging.conversation.create": {
    scope: "org",
    module: "messaging",
    label: "Start a conversation",
    requires: ["messaging.conversation.read"],
  },
  // Renaming, adding and removing members. Separate from `create`, because opening a DM
  // is something everyone does and administering a channel is not.
  "messaging.conversation.manage": {
    scope: "org",
    module: "messaging",
    label: "Manage conversations and their members",
    requires: ["messaging.conversation.read"],
  },
  "messaging.message.send": {
    scope: "org",
    module: "messaging",
    label: "Send messages",
    requires: ["messaging.conversation.read"],
  },
  // Editing and deleting your own, inside the window. Beyond it, or somebody else's,
  // takes `messaging.conversation.manage` instead.
  "messaging.message.update": {
    scope: "org",
    module: "messaging",
    label: "Edit and delete your own messages",
    requires: ["messaging.conversation.read"],
  },
} as const satisfies Record<string, PermissionMeta>;
