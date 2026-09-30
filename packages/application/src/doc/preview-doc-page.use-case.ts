import type { PreviewDocPageInput, RenderedDocDto } from "../import.js";
import type { MarkdownRenderer } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";

// The renderer publish uses, called with unsaved text. A client-side parser would be a
// second renderer, and the day the two disagree the preview lies about the page.
export class PreviewDocPageUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly renderer: MarkdownRenderer,
  ) {}

  public async execute(actor: Principal, input: PreviewDocPageInput): Promise<RenderedDocDto> {
    this.authorizer.assert(actor, "doc.page.write");
    const rendered = await this.renderer.render(input.markdown);
    return { html: rendered.html, toc: rendered.toc };
  }
}
