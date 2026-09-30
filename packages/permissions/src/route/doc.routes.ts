import type { RoutePath } from "./index.js";

// Two roots over one slice: `/doc` is a tenant's own docs behind the session, `/docs` is
// the platform's public and granted spaces, readable with no session at all.
export const docRoutes = {
  home: "/doc",
  space: "/doc/$space",
  page: "/doc/$space/$",
  manage: "/doc/manage",
  manageSpace: "/doc/manage/$spaceId",
  // Under the space it belongs to, so the editor's way back is one segment up.
  edit: "/doc/manage/$spaceId/$pageId",
  publicHome: "/docs",
  publicSpace: "/docs/$space",
  publicPage: "/docs/$space/$",
} as const satisfies Record<string, RoutePath>;
