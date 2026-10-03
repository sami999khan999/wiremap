import { Entity } from "typeorm";

@Entity("user")
export class UserEntity {
  id!: number;
}
