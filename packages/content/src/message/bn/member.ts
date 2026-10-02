import type { NamespaceBundle } from "../namespace.js";

// Total, not partial: `NamespaceBundle` is a `Record`, so an `en` key added without a
// translation fails `tsc` rather than rendering an English sentence on a Bengali page.
export const member: NamespaceBundle<"member"> = {
  "member.title": "সদস্য",
  "member.subtitle": "এই প্রতিষ্ঠানে কারা আছেন, এবং কাদের যোগ দিতে বলা হয়েছে।",
  "member.column.name": "নাম",
  "member.column.email": "ইমেল",
  "member.column.role": "ভূমিকা",
  "member.column.joined": "যোগদান",
  "member.badge.owner": "মালিক",
  "member.badge.deactivated": "নিষ্ক্রিয়",
  "member.badge.suspended": "প্ল্যাটফর্ম দ্বারা স্থগিত",
  "member.empty": "এখনও কেউ নেই।",

  "member.invitation.title": "অপেক্ষমাণ আমন্ত্রণ",
  "member.invitation.empty": "কোনো অপেক্ষমাণ আমন্ত্রণ নেই।",
  "member.invitation.invitedBy": "{name} আমন্ত্রণ জানিয়েছেন",
  "member.invitation.expires": "মেয়াদ শেষ {date}",
  "member.invitation.resend": "আবার পাঠান",
  "member.invitation.resent": "আবার পাঠানো হয়েছে। আগের লিংকটি আর কাজ করবে না।",
  "member.invitation.revoke": "প্রত্যাহার",

  "member.invite.title": "কাউকে আমন্ত্রণ জানান",
  "member.invite.email": "ইমেল ঠিকানা",
  "member.invite.role": "ভূমিকা",
  "member.invite.submit": "আমন্ত্রণ পাঠান",
  "member.invite.sent": "{email}-এ আমন্ত্রণ পাঠানো হয়েছে। এটি সাত দিন পরে মেয়াদোত্তীর্ণ হবে।",
  "member.invite.alreadyMember": "এই ঠিকানাটি ইতিমধ্যে এই প্রতিষ্ঠানের একজন সদস্যের।",

  "member.column.actions": "কার্যক্রম",
  "member.action.deactivate": "নিষ্ক্রিয় করুন",
  "member.action.reactivate": "সক্রিয় করুন",
  "member.action.changeRole": "ভূমিকা পরিবর্তন",
  "member.action.cancel": "বাতিল",
  "member.action.inspect": "কেন?",
  "member.inspect.title": "{name} এখানে যা করতে পারেন",
  "member.inspect.close": "বন্ধ করুন",
  "member.error.lastOwner": "ইনিই একমাত্র সক্রিয় মালিক। আগে অন্য কাউকে মালিক করুন।",
  "member.error.lastPlatformAdmin":
    "ইনিই একমাত্র সক্রিয় প্ল্যাটফর্ম অ্যাডমিনিস্ট্রেটর। আগে অন্য কাউকে প্ল্যাটফর্ম অ্যাডমিনিস্ট্রেটর করুন।",
  "member.error.self": "আপনি নিজের সদস্যপদ নিষ্ক্রিয় করতে পারবেন না।",

  "member.exception.one": "+ ১টি ব্যতিক্রম",
  "member.exception.other": "+ {count}টি ব্যতিক্রম",
  "member.action.access": "প্রবেশাধিকার",
  "member.access.title": "প্রবেশাধিকার ও ব্যতিক্রম",
  "member.access.close": "বন্ধ করুন",
};
