// Chat copy is short on purpose: a label beside a message competes with the message.
export const messaging = {
  "messaging.inbox.title": "Messages",
  "messaging.inbox.empty": "No conversations yet. Start one to see it here.",
  "messaging.inbox.error": "Your conversations could not be loaded.",
  "messaging.inbox.loadMore": "Load older",
  "messaging.inbox.open": "Open messages",
  "messaging.inbox.unread": "{count} unread",
  "messaging.inbox.direct": "Direct message",
  // The name of whoever is no longer resolvable. A member can outlive the row that
  // named them, and "Direct message" for a person reads as a bug rather than as a gap.
  "messaging.member.unknown": "Someone",

  "messaging.conversation.empty": "No messages yet. Say something.",
  "messaging.conversation.error": "This conversation could not be loaded.",
  "messaging.conversation.loadOlder": "Load older messages",
  "messaging.conversation.deleted": "This message was deleted.",
  "messaging.conversation.edited": "edited",
  "messaging.conversation.leave": "Leave conversation",
  "messaging.conversation.members": "In this conversation",

  "messaging.compose.placeholder": "Write a message",
  "messaging.compose.send": "Send",
  // Enter sends and Shift+Enter breaks the line, which is the convention every chat
  // client shares — saying so once is cheaper than everyone discovering it.
  "messaging.compose.hint": "Enter to send, Shift+Enter for a new line",
  "messaging.compose.tooLong": "That message is too long.",
  "messaging.compose.failed": "That message was not sent.",

  "messaging.create.title": "New conversation",
  "messaging.create.submit": "Start",
  "messaging.create.name": "Name",
  "messaging.create.people": "People",

  "messaging.typing.one": "{name} is typing…",
  "messaging.typing.many": "Several people are typing…",
} as const;
