export const aiActions = {
  "ai.document.indexed": { label: "Document indexed" },
  // The highest-volume action in the system and the first anyone will exclude, which
  // is most of why the projection policy is a row rather than a constant.
  "ai.document.searched": { label: "Document searched" },
} as const;
