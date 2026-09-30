import { NotFoundError } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { AccountRecord, AccountRepository } from "./account.repository.js";

export interface FindAccountInput {
  readonly email: string;
}

// By address, because that is what a support ticket carries. Memberships, the suspend and
// the platform's denies in every tenant, in the one catalog read.
export class FindAccountUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly accounts: AccountRepository,
  ) {}

  public async execute(actor: Principal, input: FindAccountInput): Promise<AccountRecord> {
    this.authorizer.assert(actor, "platform.account.read");

    const email = input.email.trim();
    const account = await this.accounts.findByEmail(email);
    if (!account) throw new NotFoundError("account", email);
    return account;
  }
}
