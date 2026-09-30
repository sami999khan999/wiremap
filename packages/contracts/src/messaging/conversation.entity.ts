import {
  ConversationContract,
  type ConversationDto,
  type ConversationMemberDto,
} from "./conversation.contract.js";

// Capped in the repository, and the badge says so rather than showing a number that is
// quietly a lie.
const BADGE_CAP = 99;

export class ConversationEntity {
  private constructor(private readonly dto: ConversationDto) {}

  public static from(dto: ConversationDto): ConversationEntity {
    return new ConversationEntity(ConversationContract.entity.parse(dto));
  }

  public get id(): ConversationDto["id"] {
    return this.dto.id;
  }

  // A direct conversation carries no title, so the client names it after the other
  // person. The whole member, because a caller wants the name and sometimes the id.
  public otherMember(self: string): ConversationMemberDto | null {
    if (this.dto.kind !== "direct") return null;
    return this.dto.members.find((member) => member.userId !== self) ?? null;
  }

  // What a conversation is called on screen: its own title, then the other person, and
  // `null` for a direct conversation nobody in it can still be named — copy decides then.
  public displayTitle(self: string): string | null {
    return this.dto.title ?? this.otherMember(self)?.name ?? null;
  }

  // For an author line and for a typing frame, both of which arrive holding only an id.
  public nameOf(userId: string): string | null {
    return this.dto.members.find((member) => member.userId === userId)?.name ?? null;
  }

  public get unread(): boolean {
    return this.dto.unreadCount > 0;
  }

  public get badge(): string | null {
    if (this.dto.unreadCount === 0) return null;
    return this.dto.unreadCount > BADGE_CAP ? `${BADGE_CAP}+` : String(this.dto.unreadCount);
  }

  // A channel with one owner left cannot lose them: the same rule the organization's
  // last owner has, for the same reason — nobody could administer it afterwards.
  public get lastOwner(): ConversationDto["members"][number]["userId"] | null {
    const owners = this.dto.members.filter((member) => member.role === "owner");
    return owners.length === 1 ? (owners[0]?.userId ?? null) : null;
  }
}
