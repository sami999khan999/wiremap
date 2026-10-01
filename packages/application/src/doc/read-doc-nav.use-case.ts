import { type DocSpaceNavDto, type DocSpaceNavInput, NotFoundError } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { DocCache } from "./doc.cache.js";
import { DocRules } from "./doc.rules.js";
import type { DocFeaturePolicy } from "./doc-feature.policy.js";

// A space's whole published tree, for the reader to swap in after the first paint. The
// same visibility as a page read: another author's `owner` space is not found.
export class ReadDocNavUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly cache: DocCache,
    private readonly features: DocFeaturePolicy,
  ) {}

  public async execute(actor: Principal, input: DocSpaceNavInput): Promise<DocSpaceNavDto> {
    this.authorizer.assert(actor, "doc.page.read");
    const space = DocRules.assertVisible(
      await this.cache.space(actor.organizationId, input.slug),
      actor.userId,
      "doc.space",
      input.slug,
    );
    const scope = this.features.scope(actor);
    if (!(await this.features.allows(scope, space.access))) {
      throw new NotFoundError("doc.space", input.slug);
    }
    return { version: space.version, nav: await this.features.filterNav(scope, space.nav) };
  }
}
