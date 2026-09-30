// One title and body per `NotificationKind`, interpolated from the row's `params`. The
// row carries no snapshot of what happened, so the copy has to stand on its own.
export const notification = {
  "notification.kind.member.joined.title": "Someone joined",
  "notification.kind.member.joined.body": "A new member has joined this organization.",
  "notification.kind.member.role.changed.title": "Your role changed",
  "notification.kind.member.role.changed.body":
    "An administrator changed what you can do here. Open the members page to see your new role.",

  "notification.kind.message.received.title": "New message",
  "notification.kind.message.received.body": "You have unread messages in a conversation.",

  "notification.archived.title": "Older than a year",
  "notification.archived.description":
    "Read straight out of cold storage. Nothing to restore and nothing to wait for.",
  "notification.archived.month": "Month",
  "notification.archived.column.kind": "What happened",
  "notification.archived.column.created": "When",
  // Two different empties: nothing of yours was ever archived, and nothing of yours
  // is in the month you picked. A screen saying one for the other reads as a bug.
  "notification.archived.noMonths": "Nothing of yours has been archived yet.",
  "notification.archived.empty": "You have nothing in this month.",
  "notification.archived.more": "Load more",
  "notification.inbox.title": "Notifications",
  "notification.inbox.empty": "Nothing yet. This is where updates will appear.",
  "notification.inbox.emptyUnread": "Nothing unread. Everything here has been seen.",
  "notification.inbox.error": "Your notifications could not be loaded.",
  "notification.inbox.loadMore": "Load older",
  "notification.inbox.markAllRead": "Mark all as read",
  "notification.inbox.unreadOnly": "Unread only",
  // The row control, not the filter above it. They read identically until you click
  // one of them, which is how they came to share a key.
  "notification.inbox.markRead": "Mark read",
  "notification.inbox.unreadCount": "{count} unread",
  "notification.inbox.open": "Open notifications",
  "notification.peek.loading": "Loading…",
  // "Mark read" and not "Dismiss": the row stays in the inbox, and a word that implied
  // otherwise would be a promise the list does not keep.
  "notification.peek.markRead": "Mark read",
  // Rendered even when the peek is empty. The inbox holds the read ones too.
  "notification.peek.seeAll": "See all notifications",

  "notification.preference.title": "How you hear from us",
  "notification.preference.description":
    "Choose how each kind of update reaches you. In-app notifications always appear in this list; these settings decide whether you are interrupted and whether we email you.",
  "notification.preference.category.membership": "People and roles",
  "notification.preference.category.messaging": "Messages",
  "notification.preference.channel.in_app": "In the app",
  "notification.preference.channel.email": "By email",
  "notification.preference.mode.immediate": "Straight away",
  "notification.preference.mode.digest": "Once a day",
  "notification.preference.mode.off": "Off",
  "notification.preference.saved": "Saved.",
} as const;
