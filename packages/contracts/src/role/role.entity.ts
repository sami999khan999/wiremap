import { RoleContract, type RoleDto } from "./role.contract.js";

// What a role knows about itself, with no I/O — the questions a component would
// otherwise answer inline, three times, slightly differently.
export class RoleEntity {
  private constructor(private readonly dto: RoleDto) {}

  public static from(dto: RoleDto): RoleEntity {
    return new RoleEntity(RoleContract.entity.parse(dto));
  }

  public get id(): RoleDto["id"] {
    return this.dto.id;
  }

  public get label(): string {
    return this.dto.name;
  }

  // Seeded roles are re-written on every deploy, so an edit survives until the next one
  // and then silently disappears.
  public get editable(): boolean {
    return !this.dto.isSystem;
  }

  // The only role the seed gives every tenant key, named because "why does this row show every
  // permission" is otherwise a mystery.
  public get grantsEverything(): boolean {
    return this.dto.key === "owner";
  }

  public get permissions(): readonly string[] {
    return this.dto.permissions;
  }
}
