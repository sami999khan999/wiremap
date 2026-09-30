import type { NamespaceBundle } from "../namespace.js";

// Total, not partial: `NamespaceBundle` is a `Record`, so an `en` key added without a
// translation fails `tsc` rather than rendering an English sentence on a Bengali page.
export const document: NamespaceBundle<"document"> = {
  "document.title": "নথি",
  "document.subtitle": "লেখা পেস্ট করে ইনডেক্স করুন, তারপর অর্থ ধরে খুঁজুন।",
  "document.index.title": "লেখা ইনডেক্স করুন",
  "document.index.text": "লেখা",
  "document.index.hint": "ইনডেক্সিং ওয়ার্কারে চলে, তাই জমা দেওয়ার একটু পরেই নথিটি খোঁজার উপযোগী হয়।",
  "document.index.submit": "ইনডেক্স করুন",
  "document.index.queued": "{documentId} হিসেবে সারিতে যোগ হয়েছে। একটু পরে খুঁজে দেখুন।",
  "document.search.title": "খুঁজুন",
  "document.search.query": "আপনি কী খুঁজছেন?",
  "document.search.submit": "খুঁজুন",
  "document.search.empty": "যথেষ্ট কাছাকাছি কিছু মেলেনি।",
  "document.search.score": "স্কোর {score}",
  "document.search.source": "উৎস {sourceId}",
};
