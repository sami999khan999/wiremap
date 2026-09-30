import { oc } from "../import.js";
import { Envelope } from "../primitive/index.js";
import { DocPageContract } from "./doc-page.contract.js";

export class DocPageProcedures {
  private constructor() {}

  // The reader's one call: the space, its published tree and the page, from the cache
  // when it can be.
  public static readonly read = oc
    .route({ method: "GET", path: "/doc-pages/read" })
    .input(DocPageContract.read)
    .output(DocPageContract.reading);

  // The editor's tree, drafts included.
  public static readonly tree = oc
    .route({ method: "GET", path: "/doc-pages" })
    .input(DocPageContract.listQuery)
    .output(DocPageContract.tree);

  public static readonly get = oc
    .route({ method: "GET", path: "/doc-pages/{pageId}" })
    .input(DocPageContract.get)
    .output(DocPageContract.draft);

  public static readonly create = oc
    .route({ method: "POST", path: "/doc-pages" })
    .input(DocPageContract.create)
    .output(DocPageContract.draft);

  public static readonly save = oc
    .route({ method: "PUT", path: "/doc-pages/{pageId}" })
    .input(DocPageContract.save)
    .output(DocPageContract.draft);

  public static readonly publish = oc
    .route({ method: "POST", path: "/doc-pages/{pageId}/publish" })
    .input(DocPageContract.publish)
    .output(DocPageContract.draft);

  public static readonly move = oc
    .route({ method: "POST", path: "/doc-pages/{pageId}/move" })
    .input(DocPageContract.move)
    .output(Envelope.acknowledged);

  // The page and everything under it.
  public static readonly remove = oc
    .route({ method: "DELETE", path: "/doc-pages/{pageId}" })
    .input(DocPageContract.get)
    .output(Envelope.acknowledged);

  // The same renderer publish uses, so the preview cannot disagree with the page.
  public static readonly preview = oc
    .route({ method: "POST", path: "/doc-pages/preview" })
    .input(DocPageContract.preview)
    .output(DocPageContract.rendered);

  public static readonly revisions = oc
    .route({ method: "GET", path: "/doc-pages/{pageId}/revisions" })
    .input(DocPageContract.get)
    .output(DocPageContract.revisions);

  public static readonly revision = oc
    .route({ method: "GET", path: "/doc-pages/{pageId}/revisions/{revisionNo}" })
    .input(DocPageContract.revisionRef)
    .output(DocPageContract.revision);

  public static readonly restore = oc
    .route({ method: "POST", path: "/doc-pages/{pageId}/revisions/{revisionNo}/restore" })
    .input(DocPageContract.restore)
    .output(DocPageContract.draft);

  // Full text over every published heading, and titles by prefix and typo.
  public static readonly search = oc
    .route({ method: "GET", path: "/doc-pages/search" })
    .input(DocPageContract.search)
    .output(DocPageContract.hits);

  // Signs a direct upload. The bytes never pass through the app.
  public static readonly upload = oc
    .route({ method: "POST", path: "/doc-pages/uploads" })
    .input(DocPageContract.upload)
    .output(DocPageContract.uploaded);

  public static readonly all = {
    read: DocPageProcedures.read,
    search: DocPageProcedures.search,
    upload: DocPageProcedures.upload,
    tree: DocPageProcedures.tree,
    get: DocPageProcedures.get,
    create: DocPageProcedures.create,
    save: DocPageProcedures.save,
    publish: DocPageProcedures.publish,
    move: DocPageProcedures.move,
    remove: DocPageProcedures.remove,
    preview: DocPageProcedures.preview,
    revisions: DocPageProcedures.revisions,
    revision: DocPageProcedures.revision,
    restore: DocPageProcedures.restore,
  } as const;
}
