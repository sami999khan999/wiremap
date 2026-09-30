// Totality is checked where the catalog types its loaders, not here: annotating against
// the English object would pin every value to its English literal.
export const messaging = {
  "messaging.inbox.title": "বার্তা",
  "messaging.inbox.empty": "এখনও কোনও কথোপকথন নেই। একটি শুরু করলে এখানে দেখা যাবে।",
  "messaging.inbox.error": "আপনার কথোপকথনগুলি লোড করা যায়নি।",
  "messaging.inbox.loadMore": "পুরনো দেখুন",
  "messaging.inbox.open": "বার্তা খুলুন",
  "messaging.inbox.unread": "{count}টি অপঠিত",
  "messaging.inbox.direct": "সরাসরি বার্তা",
  "messaging.member.unknown": "কেউ একজন",

  "messaging.conversation.empty": "এখনও কোনও বার্তা নেই। কিছু বলুন।",
  "messaging.conversation.error": "এই কথোপকথনটি লোড করা যায়নি।",
  "messaging.conversation.loadOlder": "পুরনো বার্তা দেখুন",
  "messaging.conversation.deleted": "এই বার্তাটি মুছে ফেলা হয়েছে।",
  "messaging.conversation.edited": "সম্পাদিত",
  "messaging.conversation.leave": "কথোপকথন ছাড়ুন",
  "messaging.conversation.members": "এই কথোপকথনে",

  "messaging.compose.placeholder": "একটি বার্তা লিখুন",
  "messaging.compose.send": "পাঠান",
  "messaging.compose.hint": "পাঠাতে Enter, নতুন লাইনের জন্য Shift+Enter",
  "messaging.compose.tooLong": "বার্তাটি খুব দীর্ঘ।",
  "messaging.compose.failed": "বার্তাটি পাঠানো যায়নি।",

  "messaging.create.title": "নতুন কথোপকথন",
  "messaging.create.submit": "শুরু করুন",
  "messaging.create.name": "নাম",
  "messaging.create.people": "সদস্য",

  "messaging.typing.one": "{name} লিখছেন…",
  "messaging.typing.many": "একাধিক জন লিখছেন…",
} as const;
