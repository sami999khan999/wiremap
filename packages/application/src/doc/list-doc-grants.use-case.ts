import type { DocGrantListDto, ListDocGrantsInput } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { DocGrantRepository } from "./doc-grant.repository.js";

// Who a private space is open to, expired grants included so an operator can see why
// somebody lost access.
export class ListDocGrantsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly grants: DocGrantRepository,
  ) {}

  public async execute(actor: Principal, input: ListDocGrantsInput): Promise<DocGrantListDto> {
    this.authorizer.assert(actor, "platform.doc.grant");
    return { items: await this.grants.list(input.spaceId) };
  }
}
