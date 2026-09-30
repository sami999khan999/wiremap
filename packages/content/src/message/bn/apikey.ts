import type { NamespaceBundle } from "../namespace.js";

// Total, not partial: `NamespaceBundle` is a `Record`, so an `en` key added without a
// translation fails `tsc` rather than rendering an English sentence on a Bengali page.
export const apikey: NamespaceBundle<"apikey"> = {
  "apikey.title": "API কী",
  "apikey.subtitle": "এই প্রতিষ্ঠানের হয়ে কাজ করা স্ক্রিপ্ট ও ইন্টিগ্রেশনের জন্য ক্রেডেনশিয়াল।",
  "apikey.column.name": "নাম",
  "apikey.column.prefix": "কী",
  "apikey.column.scopes": "স্কোপ",
  "apikey.column.lastUsed": "সর্বশেষ ব্যবহার",
  "apikey.column.status": "অবস্থা",
  "apikey.column.actions": "কার্যক্রম",
  "apikey.status.active": "সক্রিয়",
  "apikey.status.revoked": "বাতিল",
  "apikey.status.expired": "মেয়াদোত্তীর্ণ",
  "apikey.lastUsed.never": "কখনও নয়",
  "apikey.empty": "এখনও কোনো API কী নেই।",
  "apikey.create.title": "নতুন API কী",
  "apikey.create.name": "এটি কীসের জন্য?",
  "apikey.create.nameHint": "ছয় মাস পরেও এই তালিকায় আপনি চিনতে পারবেন এমন একটি নাম।",
  "apikey.create.scopes": "স্কোপ",
  "apikey.create.scopesHint": "আপনি নিজে যে অনুমতিগুলি রাখেন কেবল সেগুলিই দিতে পারবেন।",
  "apikey.create.submit": "কী তৈরি করুন",
  "apikey.created.title": "এখনই কী-টি কপি করুন",
  "apikey.created.warning":
    "এটি কেবল এখনই দেখানো হচ্ছে। এটি ডাইজেস্ট হিসেবে সংরক্ষিত, তাই আমরা সহ কেউই আপনাকে এটি আর দেখাতে পারবে না।",
  "apikey.created.done": "আমি কপি করেছি",
  "apikey.action.revoke": "বাতিল করুন",
  "apikey.revoke.confirm": "{name} বাতিল করবেন? এটি ব্যবহার করা সবকিছু সঙ্গে সঙ্গে কাজ করা বন্ধ করবে।",
  "apikey.error.escalate": "আপনি নিজে যে স্কোপ রাখেন না, তা দিতে পারবেন না।",
  "apikey.error.scopes": "ক্যাটালগ চেনে এমন অন্তত একটি স্কোপ বেছে নিন।",
  "apikey.error.past": "মেয়াদ শেষের সময়টি ইতিমধ্যে অতীত।",
};
