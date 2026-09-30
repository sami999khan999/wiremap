import { MemberContract, type MemberDto } from "./member.contract.js";

// What a member row knows about itself, with no I/O — the questions a list would
// otherwise answer inline, once per column.
export class MemberEntity {
  private constructor(private readonly dto: MemberDto) {}

  public static from(dto: MemberDto): MemberEntity {
    return new MemberEntity(MemberContract.entity.parse(dto));
  }

  public get id(): MemberDto["userId"] {
    return this.dto.userId;
  }

  public get label(): string {
    return this.dto.name;
  }

  // `owner` lists every tenant key, so a list marks it: it is the one row whose removal
  // can lock a tenant.
  public get isOwner(): boolean {
    return this.dto.roleKey === "owner";
  }

  public get active(): boolean {
    return !this.dto.deactivated;
  }

  // Not folded into `active`: the membership is intact, and reinstating the account is
  // the platform's call, so the list says whose lock it is.
  public get suspended(): boolean {
    return this.dto.suspended;
  }
}
