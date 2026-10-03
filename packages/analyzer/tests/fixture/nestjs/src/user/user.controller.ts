import { Body, Controller, Get, Post, Put, UseGuards } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";
import { UserService } from "./user.service";

@Controller()
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get("user")
  @UseGuards(AuthGuard)
  async findMe() {
    return this.userService.findById(1);
  }

  @Put("user")
  @UseGuards(AuthGuard)
  async update(@Body() body: unknown) {
    return body;
  }

  @Post("users")
  async create(@Body() body: unknown) {
    return this.userService.create(body);
  }

  @Post("users/login")
  async login(@Body() body: unknown) {
    return body;
  }
}
