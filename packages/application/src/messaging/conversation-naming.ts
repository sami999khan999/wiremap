import type { OrganizationId } from "../import.js";
import type { UserReader } from "../port/index.js";
import type { ConversationMemberRecord, ConversationRecord } from "./conversation.repository.js";

// What the repository cannot know. `conversation_members` is routed and `users` is
// catalog, so the name arrives as a second statement rather than as a join.
export interface NamedConversationMember extends ConversationMemberRecord {
  readonly name: string | null;
}

export interface NamedConversation extends Omit<ConversationRecord, "members"> {
  readonly members: readonly NamedConversationMember[];
}

export class ConversationNaming {
  public constructor(private readonly users: UserReader) {}

  // One statement for a whole page, not one per conversation: twenty-five rows of a
  // hundred members each is two queries this way and twenty-six the obvious way.
  public async attach(
    organizationId: OrganizationId,
    conversations: readonly ConversationRecord[],
  ): Promise<readonly NamedConversation[]> {
    const ids = conversations.flatMap((conversation) =>
      conversation.members.map((member) => member.userId),
    );
    const names = await this.users.namesOf(organizationId, ids);

    return conversations.map((conversation) => ({
      ...conversation,
      members: conversation.members.map((member) => ({
        ...member,
        name: names.get(member.userId) ?? null,
      })),
    }));
  }

  // **Never inside a unit of work.** A routed transaction is open there and this reads
  // the catalog, which is the crossing `data.md` forbids. See docs/reference/messaging.md.
  public async attachOne(
    organizationId: OrganizationId,
    conversation: ConversationRecord,
  ): Promise<NamedConversation> {
    const [named] = await this.attach(organizationId, [conversation]);
    if (!named) throw new Error("attach returned nothing for one conversation.");
    return named;
  }
}
