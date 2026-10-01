import type { OrganizationId } from "../import.js";
import type { MarkdownRenderer, UnitOfWork } from "../port/index.js";
import type { DocCache } from "./doc.cache.js";
import type { DocPageRepository } from "./doc-page.repository.js";

// Renders again every published page an older renderer wrote, for one organization. Run
// by the worker, placed on the tenant's node; queued by `pnpm doc:rerender`.
export class DocRerender {
  private static readonly BATCH = 50;

  public constructor(
    private readonly pages: DocPageRepository,
    private readonly renderer: MarkdownRenderer,
    private readonly cache: DocCache,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async run(organizationId: OrganizationId): Promise<number> {
    let done = 0;
    for (;;) {
      const stale = await this.pages.listStale(
        organizationId,
        this.renderer.version,
        DocRerender.BATCH,
      );
      if (stale.length === 0) return done;

      for (const page of stale) {
        // Outside the transaction: rendering is CPU, and a held transaction is a connection.
        const rendered = await this.renderer.render(page.markdown);
        await this.unitOfWork.run(async () => {
          await this.pages.saveRendering(organizationId, page.id, {
            html: rendered.html,
            toc: rendered.toc,
            rendererVersion: this.renderer.version,
          });
          // The title is a section of its own, as publishing writes it.
          await this.pages.saveSections(organizationId, page.spaceId, page.id, [
            { anchor: null, heading: page.title, body: page.description ?? "" },
            ...rendered.sections,
          ]);
        });
        await this.cache.forgetPage(organizationId, page.id, page.revisionNo);
        done += 1;
      }
    }
  }
}
