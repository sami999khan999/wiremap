import type { NamespaceBundle } from "../namespace.js";

// Total, like every bundle here. `error.serverOnly` is translated even though a
// developer reads it in a console: a hole in the type is worse than an unread sentence.
export const error: NamespaceBundle<"error"> = {
  "error.unauthorized": "চালিয়ে যেতে সাইন ইন করুন।",
  "error.forbidden": "এটি করার অনুমতি আপনার নেই।",
  "error.notFound": "আপনি যা খুঁজছেন তা আমরা পাইনি।",
  "error.unexpected": "কিছু ভুল হয়েছে। আবার চেষ্টা করুন।",
  "error.field.required": "{field} আবশ্যক।",
  "error.field.tooShort": "{field} অন্তত {min}টি অক্ষরের হতে হবে।",
  "error.field.tooLong": "{field} সর্বোচ্চ {max}টি অক্ষরের হতে পারে।",
  "error.field.invalidFormat": "{field} প্রত্যাশিত বিন্যাসে নেই।",
  "error.field.invalid": "{field} বৈধ নয়।",
  "error.field.unknown": "{field} আমাদের চেনা কোনো মান নয়।",
  "error.field.past": "{field} অতীতের হতে হবে।",
  "error.field.range": "{field} অনুমোদিত সীমার বাইরে।",
  "error.field.min": "{field} অনুমোদিত সর্বনিম্ন মানের চেয়ে ছোট।",
  "error.field.taken": "{field} ইতিমধ্যে ব্যবহৃত হচ্ছে।",
  "error.field.private": "{field} শুধু এর লেখকের, তাই এটি শেয়ার করা যায় না।",
  "error.conflict": "অন্য কেউ আগেই এটি পরিবর্তন করেছেন। পৃষ্ঠাটি রিলোড করে আবার চেষ্টা করুন।",
  "error.rateLimited": "অনেক বেশি চেষ্টা হয়েছে। একটু অপেক্ষা করে আবার চেষ্টা করুন।",
  "error.twoFactorRequired": "চালিয়ে যেতে আপনার অথেনটিকেটর অ্যাপের কোডটি দিন।",
  "error.accountSuspended": "এই অ্যাকাউন্টটি স্থগিত করা হয়েছে। এটি ফিরিয়ে আনতে সাপোর্টের সাথে যোগাযোগ করুন।",
  "error.serverOnly":
    "{package} একটি ক্লায়েন্ট বান্ডলে ঢুকে পড়েছে। এটি বান্ডলের আকারের সমস্যা নয়, একটি ফাঁস — অর্থাৎ ডেটাবেস বা ক্রেডেনশিয়াল কোড ব্রাউজার থেকে নাগালযোগ্য।",
};
