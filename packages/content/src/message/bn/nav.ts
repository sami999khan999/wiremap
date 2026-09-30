import type { NamespaceBundle } from "../namespace.js";

// Total, not partial: `NamespaceBundle` is a `Record`, so an `en` key added without a
// translation fails `tsc` rather than rendering an English sentence on a Bengali page.
export const nav: NamespaceBundle<"nav"> = {
  "nav.signOut": "সাইন আউট",
  "nav.signOutFailed": "সাইন আউট করা যায়নি। আবার চেষ্টা করুন।",
  "nav.account": "অ্যাকাউন্ট",
  "nav.security": "নিরাপত্তা",
  "nav.organization": "প্রতিষ্ঠান",
  "nav.organizationNew": "নতুন প্রতিষ্ঠান",
  "nav.skip": "মূল বিষয়বস্তুতে যান",
  "nav.sections": "বিভাগসমূহ",

  "nav.roles": "ভূমিকা",
  "nav.members": "সদস্যরা",
  "nav.apiKeys": "API কী",
  "nav.documents": "নথি",
  "nav.notifications": "বিজ্ঞপ্তি",
  "nav.platform": "প্ল্যাটফর্ম",
  "nav.docs": "ডক",

  "nav.home.title": "{organization}",
  "nav.home.role": "এখানে আপনি {role}।",
  "nav.home.members": "সদস্য: {count}",
  "nav.home.signedOut": "চালিয়ে যেতে সাইন ইন করুন।",
  "nav.home.goToSignIn": "সাইন ইন",
};
