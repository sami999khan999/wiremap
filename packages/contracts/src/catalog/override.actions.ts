// One person's exceptions to their role. Past tense, like every activity: each records a
// change that happened. The payload names the person and the keys.
export const overrideActions = {
  "override.granted": { label: "Permission granted to one person" },
  "override.denied": { label: "Permission denied to one person" },
  "override.cleared": { label: "Exception cleared" },
  // Written by the worker's sweep, as the system principal, in the org the grant belonged to.
  "override.expired": { label: "Exception expired" },
} as const;
