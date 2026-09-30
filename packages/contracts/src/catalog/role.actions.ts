// Past tense, always — the vocabulary rule: a permission is a right you hold, an
// activity is a fact that happened. The label is what the projection screen renders.
export const roleActions = {
  "role.created": { label: "Role created" },
  "role.updated": { label: "Role updated" },
  "role.deleted": { label: "Role deleted" },
  "role.permission.granted": { label: "Permission granted" },
  "role.permission.revoked": { label: "Permission revoked" },
} as const;
