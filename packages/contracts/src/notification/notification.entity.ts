import { NotificationContract, type NotificationDto } from "./notification.contract.js";

// What a notification row knows about itself, with no I/O — the questions a list would
// otherwise answer inline, once per row.
export class NotificationEntity {
  private constructor(private readonly dto: NotificationDto) {}

  public static from(dto: NotificationDto): NotificationEntity {
    return new NotificationEntity(NotificationContract.entity.parse(dto));
  }

  public get id(): NotificationDto["id"] {
    return this.dto.id;
  }

  public get unread(): boolean {
    return this.dto.readAt === null;
  }

  // The copy key the client renders. Derived here rather than in a component, so the
  // one place that has to change when a kind is added is the copy catalog.
  public get titleKey(): string {
    return `notification.kind.${this.dto.kind}.title`;
  }

  public get bodyKey(): string {
    return `notification.kind.${this.dto.kind}.body`;
  }

  // Not every notification has somewhere to go, and a row rendered as a dead link is
  // worse than one rendered as a statement.
  public get actionable(): boolean {
    return this.dto.link !== null;
  }
}
