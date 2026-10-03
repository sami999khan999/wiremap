import { Injectable } from "@nestjs/common";
import { UserService } from "../user/user.service";
import { slugify } from "../shared/slug";

@Injectable()
export class ArticleService {
  constructor(private readonly users: UserService) {}

  findAll() {
    return [slugify("a")];
  }
}
