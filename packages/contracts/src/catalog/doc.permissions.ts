import type { PermissionKey } from "../import.js";

// Necessary, never sufficient: every use-case also reads the space's audience. See
// packages/application/docs/reference/doc.md.
export const docProcedurePermissions = {
  "docSpace.list": "doc.page.read",
  "docSpace.get": "doc.page.read",
  "docSpace.nav": "doc.page.read",
  "docSpace.create": "doc.space.manage",
  "docSpace.update": "doc.space.manage",
  "docSpace.remove": "doc.space.manage",
  "docPage.read": "doc.page.read",
  "docPage.search": "doc.page.read",
  // The editor's views show drafts, which a reader never sees.
  "docPage.tree": "doc.page.write",
  "docPage.get": "doc.page.write",
  "docPage.create": "doc.page.write",
  "docPage.save": "doc.page.write",
  "docPage.publish": "doc.page.publish",
  "docPage.move": "doc.page.write",
  "docPage.remove": "doc.page.write",
  "docPage.preview": "doc.page.write",
  "docPage.upload": "doc.page.write",
  "docPage.revisions": "doc.page.write",
  "docPage.revision": "doc.page.write",
  "docPage.restore": "doc.page.write",
  // The platform admin's, from any organization: a grant is catalog policy, not a tenant's.
  "docGrant.list": "platform.doc.grant",
  "docGrant.save": "platform.doc.grant",
  "docGrant.revoke": "platform.doc.grant",
} as const satisfies Record<string, PermissionKey>;
