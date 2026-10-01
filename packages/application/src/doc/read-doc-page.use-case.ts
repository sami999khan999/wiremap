import type { DocReadingDto, ReadDocPageInput } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { DocCache } from "./doc.cache.js";
import { DocRules } from "./doc.rules.js";
import { DocShape } from "./doc-shape.js";

// A member reading their own organization's docs. Every audience is theirs to read but
// another author's `owner` space, which answers as though it did not exist.
export class ReadDocPageUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly cache: DocCache,
  ) {}

  public async execute(actor: Principal, input: ReadDocPageInput): Promise<DocReadingDto> {
    this.authorizer.assert(actor, "doc.page.read");
    const space = DocRules.assertVisible(
      await this.cache.space(actor.organizationId, input.space),
      actor.userId,
      "doc.space",
      input.space,
    );
    const { page } = await this.cache.readIn(space, input.path);
    // Trimmed: a large space's whole tree in every page read is what made one slow.
    const nav = DocRules.trimNav(space.nav, page?.id ?? null);
    return { space: { ...DocShape.space(space), nav }, page };
  }
}
