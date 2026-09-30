import type { DocImageType, DocSpaceId, OrganizationId } from "../import.js";

const EXTENSIONS: Readonly<Record<DocImageType, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const TYPES: ReadonlyMap<string, DocImageType> = new Map(
  (Object.entries(EXTENSIONS) as [DocImageType, string][]).map(([type, ext]) => [ext, type]),
);

// A doc image's storage key and its URL, which carry the same three facts. Per tenant and
// per space, so deleting either is one prefix — see application/docs/reference/doc.md.
export class DocImageKey {
  private constructor() {}

  public static key(organizationId: OrganizationId, spaceId: DocSpaceId, file: string): string {
    return `${DocImageKey.spacePrefix(organizationId, spaceId)}${file}`;
  }

  // `<uuid>.<ext>`, the only file name a key ever holds: the author's own is never used.
  public static file(id: string, type: DocImageType): string {
    return `${id}.${EXTENSIONS[type]}`;
  }

  // The route a page links, never the bucket. The type is a segment, not an extension: a
  // dev server serves a path ending `.png` as a file and never asks the app.
  public static url(organizationId: OrganizationId, spaceId: DocSpaceId, file: string): string {
    const [id, extension] = file.split(".");
    return `/api/doc-image/${organizationId}/${spaceId}/${extension}/${id}`;
  }

  // The route's two segments back into the file name, or null when they name nothing
  // this class would have written.
  public static fileOf(extension: string, id: string): string | null {
    const file = `${id}.${extension}`;
    return DocImageKey.typeOf(file) === null ? null : file;
  }

  // Null for anything that is not a file this class would have named.
  public static typeOf(file: string): DocImageType | null {
    const match = /^[0-9a-f-]{36}\.([a-z]+)$/.exec(file);
    return match ? (TYPES.get(match[1] ?? "") ?? null) : null;
  }

  public static tenantPrefix(organizationId: OrganizationId): string {
    return `doc/${organizationId}/`;
  }

  public static spacePrefix(organizationId: OrganizationId, spaceId: DocSpaceId): string {
    return `${DocImageKey.tenantPrefix(organizationId)}${spaceId}/`;
  }
}
