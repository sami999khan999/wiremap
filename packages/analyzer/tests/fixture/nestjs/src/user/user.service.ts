import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { UserEntity } from "./user.entity";

@Injectable()
export class UserService {
  constructor(@InjectRepository(UserEntity) private readonly users: Repository<UserEntity>) {}

  findById(id: number) {
    return this.users.findOneBy({ id });
  }

  create(body: unknown) {
    return body;
  }
}
