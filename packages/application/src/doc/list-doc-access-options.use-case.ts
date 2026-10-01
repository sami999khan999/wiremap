import type { DocAccessOptionsDto } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { DocFeaturePolicy } from "./doc-feature.policy.js";

// The modules, permissions, flags and plans a writer may link a doc to, for the pickers.
// Anyone who may write a page may link it: a link only narrows who reads it.
export class ListDocAccessOptionsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly features: DocFeaturePolicy,
  ) {}

  public async execute(actor: Principal): Promise<DocAccessOptionsDto> {
    this.authorizer.assert(actor, "doc.page.write");
    return this.features.options();
  }
}
