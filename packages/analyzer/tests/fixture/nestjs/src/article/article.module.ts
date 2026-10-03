import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { AuthMiddleware } from "../user/auth.middleware";
import { UserModule } from "../user/user.module";
import { ArticleController } from "./article.controller";
import { ArticleService } from "./article.service";

@Module({ imports: [UserModule], controllers: [ArticleController], providers: [ArticleService] })
export class ArticleModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes({ path: "articles/:slug", method: RequestMethod.DELETE });
  }
}
