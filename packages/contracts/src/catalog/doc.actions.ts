// A draft save is not here: it changes nothing a reader sees, and an audit row per
// keystroke-debounced save would bury the publishes that did.
export const docActions = {
  "doc.space.created": { label: "Doc space created" },
  "doc.space.updated": { label: "Doc space updated" },
  "doc.space.deleted": { label: "Doc space deleted" },
  "doc.page.created": { label: "Doc page created" },
  "doc.page.published": { label: "Doc page published" },
  "doc.page.moved": { label: "Doc page moved" },
  "doc.page.deleted": { label: "Doc page deleted" },
  "doc.page.restored": { label: "Doc page revision restored to draft" },
  "doc.grant.saved": { label: "Private docs opened to an organization, person or plan" },
  "doc.grant.revoked": { label: "Private docs access withdrawn" },
} as const;
