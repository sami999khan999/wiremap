import type { UserId } from "../primitive/index.js";
import { MessageContract, type MessageDto } from "./message.contract.js";

export class MessageEntity {
  private constructor(private readonly dto: MessageDto) {}

  public static from(dto: MessageDto): MessageEntity {
    return new MessageEntity(MessageContract.entity.parse(dto));
  }

  public get id(): MessageDto["id"] {
    return this.dto.id;
  }

  // A deleted row keeps its place so the conversation keeps its shape and the keyset
  // cursor over it stays stable. The client renders a placeholder, not the empty body.
  public get renderable(): boolean {
    return !this.dto.deleted;
  }

  public get edited(): boolean {
    return this.dto.editedAt !== null;
  }

  public authoredBy(userId: UserId): boolean {
    return this.dto.authorId === userId;
  }
}
