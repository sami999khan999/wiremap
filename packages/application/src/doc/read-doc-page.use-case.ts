import type { DocReadingDto, ReadDocPageInput } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { DocCache } from "./doc.cache.js";
import { DocShape } from "./doc-shape.js";

// A member reading their own organization's docs. Every audience is theirs to read: the
// audience only widens who else may, through the platform's read path.
export class ReadDocPageUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly cache: DocCache,
  ) {}

  public async execute(actor: Principal, input: ReadDocPageInput): Promise<DocReadingDto> {
    this.authorizer.assert(actor, "doc.page.read");
    const { space, page } = await this.cache.read(actor.organizationId, input.space, input.path);
    return { space: { ...DocShape.space(space), nav: space.nav }, page };
  }
}
