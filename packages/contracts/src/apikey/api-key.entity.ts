import { ApiKeyContract, type ApiKeyDto } from "./api-key.contract.js";

// What a key row knows about itself, with no I/O — the three questions a list would
// otherwise answer inline, once per column, slightly differently.
export class ApiKeyEntity {
  private constructor(private readonly dto: ApiKeyDto) {}

  public static from(dto: ApiKeyDto): ApiKeyEntity {
    return new ApiKeyEntity(ApiKeyContract.entity.parse(dto));
  }

  public get id(): ApiKeyDto["id"] {
    return this.dto.id;
  }

  public get label(): string {
    return this.dto.name;
  }

  public get revoked(): boolean {
    return this.dto.revokedAt !== null;
  }

  // Takes the instant rather than reading the clock: a component renders many rows in
  // one pass, and two of them disagreeing about "now" is a bug nobody reproduces.
  public expired(now: Date): boolean {
    return this.dto.expiresAt !== null && this.dto.expiresAt <= now;
  }

  // The only state in which the key still authenticates. `ApiKeyResolver` applies the
  // same two checks server-side, which is what makes this a label and not a gate.
  public usable(now: Date): boolean {
    return !this.revoked && !this.expired(now);
  }
}
