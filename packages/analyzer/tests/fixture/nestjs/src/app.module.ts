import { Module } from "@nestjs/common";
import { ArticleModule } from "./article/article.module";
import { UserModule } from "./user/user.module";

@Module({ imports: [UserModule, ArticleModule] })
export class AppModule {}
