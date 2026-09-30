import { authed } from "../import.js";

// Moves input in and a result out. Rendering, locking and the tree are the use-cases'.
export class DocPageRouter {
  private constructor() {}

  public static readonly read = authed.docPage.read.handler(({ input, context }) =>
    context.container.doc.read.execute(context.principal, input),
  );

  public static readonly search = authed.docPage.search.handler(({ input, context }) =>
    context.container.doc.search.execute(context.principal, input),
  );

  public static readonly upload = authed.docPage.upload.handler(({ input, context }) =>
    context.container.doc.uploadImage.execute(context.principal, input),
  );

  public static readonly tree = authed.docPage.tree.handler(({ input, context }) =>
    context.container.doc.tree.execute(context.principal, input),
  );

  public static readonly get = authed.docPage.get.handler(({ input, context }) =>
    context.container.doc.getPage.execute(context.principal, input),
  );

  public static readonly create = authed.docPage.create.handler(({ input, context }) =>
    context.container.doc.createPage.execute(context.principal, input),
  );

  public static readonly save = authed.docPage.save.handler(({ input, context }) =>
    context.container.doc.savePage.execute(context.principal, input),
  );

  public static readonly publish = authed.docPage.publish.handler(({ input, context }) =>
    context.container.doc.publishPage.execute(context.principal, input),
  );

  public static readonly move = authed.docPage.move.handler(async ({ input, context }) => {
    await context.container.doc.movePage.execute(context.principal, input);
    return { ok: true } as const;
  });

  public static readonly remove = authed.docPage.remove.handler(async ({ input, context }) => {
    await context.container.doc.deletePage.execute(context.principal, input);
    return { ok: true } as const;
  });

  public static readonly preview = authed.docPage.preview.handler(({ input, context }) =>
    context.container.doc.previewPage.execute(context.principal, input),
  );

  public static readonly revisions = authed.docPage.revisions.handler(({ input, context }) =>
    context.container.doc.revisions.execute(context.principal, input),
  );

  public static readonly revision = authed.docPage.revision.handler(({ input, context }) =>
    context.container.doc.revision.execute(context.principal, input),
  );

  public static readonly restore = authed.docPage.restore.handler(({ input, context }) =>
    context.container.doc.restoreRevision.execute(context.principal, input),
  );

  public static readonly all = {
    read: DocPageRouter.read,
    search: DocPageRouter.search,
    upload: DocPageRouter.upload,
    tree: DocPageRouter.tree,
    get: DocPageRouter.get,
    create: DocPageRouter.create,
    save: DocPageRouter.save,
    publish: DocPageRouter.publish,
    move: DocPageRouter.move,
    remove: DocPageRouter.remove,
    preview: DocPageRouter.preview,
    revisions: DocPageRouter.revisions,
    revision: DocPageRouter.revision,
    restore: DocPageRouter.restore,
  } as const;
}
