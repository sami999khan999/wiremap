import type { NamespaceBundle } from "../namespace.js";

// Total, not partial: `NamespaceBundle` is a `Record`, so an `en` key added without a
// translation fails `tsc` rather than rendering an English sentence on a Bengali page.
export const organization: NamespaceBundle<"organization"> = {
  "organization.create.title": "নতুন প্রতিষ্ঠান",
  "organization.create.name": "প্রতিষ্ঠানের নাম",
  "organization.create.hint":
    "আপনি এর মালিক হবেন, এবং যেকোনো সময় আপনার অন্য প্রতিষ্ঠানগুলিতে ফিরে যেতে পারবেন।",
  "organization.create.submit": "প্রতিষ্ঠান তৈরি করুন",

  "organization.invitation.title": "আপনাকে আমন্ত্রণ জানানো হয়েছে",
  "organization.invitation.intro": "{organization} {email}-কে যোগ দিতে আমন্ত্রণ জানিয়েছে।",
  "organization.invitation.accept": "{organization}-এ যোগ দিন",
  "organization.invitation.signIn": "{email} হিসেবে সাইন ইন করুন",
  "organization.invitation.signUp": "{email} দিয়ে একটি অ্যাকাউন্ট তৈরি করুন",
  "organization.invitation.wrongAccount":
    "এই আমন্ত্রণটি {email}-এ পাঠানো হয়েছিল, কিন্তু আপনি {current} হিসেবে সাইন ইন করেছেন। সাইন আউট করে আমন্ত্রিত ঠিকানা দিয়ে সাইন ইন করুন।",
  "organization.invitation.expired":
    "এই আমন্ত্রণের মেয়াদ শেষ হয়ে গেছে। {organization}-এর কাউকে নতুন একটি পাঠাতে বলুন।",
  "organization.invitation.missing":
    "এই আমন্ত্রণটি আর বৈধ নয়। এটি প্রত্যাহার করা হয়েছে বা ইতিমধ্যে ব্যবহৃত হয়েছে।",
};
