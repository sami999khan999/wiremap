import { OrganizationContract, type OrganizationDto } from "./organization.contract.js";

// What the settings page asks of an organization with no I/O.
export class OrganizationEntity {
  private constructor(private readonly dto: OrganizationDto) {}

  public static from(dto: OrganizationDto): OrganizationEntity {
    return new OrganizationEntity(OrganizationContract.entity.parse(dto));
  }

  public get id(): OrganizationDto["id"] {
    return this.dto.id;
  }

  // A delete is confirmed by typing this back, exactly.
  public confirms(typed: string): boolean {
    return typed.trim() === this.dto.slug;
  }
}
