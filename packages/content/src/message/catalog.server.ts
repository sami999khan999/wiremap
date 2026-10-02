import { CLIENT_CATALOG, type MessageCatalog } from "./catalog.js";
import { email as enEmail } from "./en/email.js";

// Static imports, not `import()`: a dynamic specifier makes rollup emit a chunk that
// lands in the public assets directory even after this catalog is tree-shaken out.
export const SERVER_CATALOG: MessageCatalog = {
  en: { ...CLIENT_CATALOG.en, email: () => Promise.resolve(enEmail) },
};
