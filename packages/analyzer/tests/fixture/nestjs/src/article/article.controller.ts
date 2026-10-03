import { Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../user/auth.guard";
import { ArticleService } from "./article.service";

@Controller("articles")
export class ArticleController {
  constructor(private readonly articles: ArticleService) {}

  @Get()
  findAll() {
    return this.articles.findAll();
  }

  @Get(":slug")
  findOne(@Param("slug") slug: string) {
    return slug;
  }

  @UseGuards(AuthGuard)
  @Post()
  create() {
    return {};
  }

  @Delete(":slug")
  remove(@Param("slug") slug: string) {
    return slug;
  }
}
