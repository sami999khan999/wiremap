import type { NamespaceBundle } from "../namespace.js";

// Total, not partial: `NamespaceBundle` is a `Record`, so an `en` key added without a
// translation fails `tsc` rather than rendering an English sentence on a Bengali page.
export const email: NamespaceBundle<"email"> = {
  "email.digest.subject": "আপনার দৈনিক সারসংক্ষেপ — {count}টি হালনাগাদ",
  "email.digest.subjectEmpty": "আপনার দৈনিক সারসংক্ষেপ",
  "email.digest.greeting": "নমস্কার {name},",
  "email.digest.intro": "গতকাল থেকে আপনার লক্ষ্যগুলিতে যা পরিবর্তন হয়েছে।",
  "email.digest.empty": "গতকাল থেকে কিছুই পরিবর্তন হয়নি।",
  "email.digest.viewAll": "ড্যাশবোর্ড খুলুন",
  "email.digest.footer": "আপনি {organization}-এর সদস্য বলে এই বার্তাটি পাচ্ছেন।",

  "email.verify.subject": "আপনার ইমেল ঠিকানা নিশ্চিত করুন",
  "email.verify.body":
    "এই ঠিকানাটি নিশ্চিত করে আপনার অ্যাকাউন্ট তৈরি সম্পূর্ণ করতে নিচের লিঙ্কটি খুলুন। এটি এক ঘণ্টা পরে মেয়াদোত্তীর্ণ হবে। আপনি নিবন্ধন না করে থাকলে বার্তাটি উপেক্ষা করুন।",
  "email.verify.action": "এই ঠিকানা নিশ্চিত করুন",
  "email.reset.subject": "আপনার পাসওয়ার্ড পুনঃনির্ধারণ করুন",
  "email.reset.body":
    "নতুন পাসওয়ার্ড বেছে নিতে নিচের লিঙ্কটি খুলুন। এটি এক ঘণ্টা পরে মেয়াদোত্তীর্ণ হবে। আপনি অনুরোধ না করে থাকলে কিছুই পরিবর্তন হয়নি।",
  "email.reset.action": "নতুন পাসওয়ার্ড বেছে নিন",
  "email.change.subject": "আপনার ইমেল ঠিকানা পরিবর্তন নিশ্চিত করুন",
  "email.change.body":
    "কেউ এই অ্যাকাউন্টটি অন্য একটি ইমেল ঠিকানায় সরাতে চেয়েছে। অনুমোদন করতে নিচের লিঙ্কটি খুলুন। এই বার্তাটি ইচ্ছাকৃতভাবে আপনার বর্তমান ঠিকানায় পাঠানো হয়েছে — আপনি না করে থাকলে লিঙ্কটি খুলবেন না, আপনার পাসওয়ার্ড পরিবর্তন করুন।",
  "email.change.action": "পরিবর্তন অনুমোদন করুন",

  "email.otp.subject": "আপনার সাইন-ইন কোড",
  "email.otp.body": "আপনার সাইন-ইন কোড {code}।",
  "email.otp.expiry":
    "এটি পাঁচ মিনিট পরে মেয়াদোত্তীর্ণ হবে। আপনি সাইন ইন করার চেষ্টা না করে থাকলে কেউ আপনার পাসওয়ার্ড জানে — এটি পরিবর্তন করুন।",

  "email.invitation.subject": "{inviter} আপনাকে {organization}-এ আমন্ত্রণ জানিয়েছেন",
  "email.invitation.body":
    "{inviter} আপনাকে {organization}-এ যোগ দিতে আমন্ত্রণ জানিয়েছেন। গ্রহণ করতে নিচের লিঙ্কটি খুলুন। আপনার অ্যাকাউন্ট না থাকলে এই ঠিকানা দিয়ে একটি তৈরি করতে বলা হবে — আমন্ত্রণটি এই ঠিকানার সাথে যুক্ত। এটি সাত দিন পরে মেয়াদোত্তীর্ণ হবে; আপনি এটি আশা না করে থাকলে উপেক্ষা করুন।",
  "email.invitation.action": "{organization}-এ যোগ দিন",
  "email.digest.unsubscribe": "আমরা কত ঘন ঘন যোগাযোগ করব তা বদলান",

  "email.notification.subject": "আপনার কর্মক্ষেত্রে একটি হালনাগাদ আছে",
  "email.notification.greeting": "হ্যালো {name},",
  "email.notification.body":
    "আপনি যে বিষয়ে জানতে চেয়েছিলেন তেমন কিছু বদলেছে। কী বদলেছে দেখতে আপনার বিজ্ঞপ্তিগুলো খুলুন।",
  "email.notification.action": "বিজ্ঞপ্তি খুলুন",
};
