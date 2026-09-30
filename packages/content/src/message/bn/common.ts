import type { NamespaceBundle } from "../namespace.js";

// Total, not partial: `NamespaceBundle` is a `Record`, so an `en` key added without a
// translation fails `tsc` rather than rendering an English sentence on a Bengali page.
export const common: NamespaceBundle<"common"> = {
  "action.save": "সংরক্ষণ",
  "action.cancel": "বাতিল",
  "action.delete": "মুছে ফেলুন",
  "locale.label": "ভাষা",
  "state.loading": "লোড হচ্ছে…",
  "state.allowed": "অনুমোদিত",
  "state.denied": "অননুমোদিত",
  "action.confirm": "নিশ্চিত করুন",
  "action.retry": "আবার চেষ্টা করুন",
  "state.empty": "এখানে এখনও কিছু নেই",
  "state.error": "কিছু ভুল হয়েছে",
};
