import type { ConversationMemberRole, UserId } from "../import.js";

// The decisions the messaging use-cases share. Written twice they would eventually
// disagree about what a direct key is, and two DMs for one pair is not recoverable.
export class MessagingRules {
  private constructor() {}

  // Long enough to fix a typo, short enough that a conversation is a record of what was
  // said. Beyond it an author needs `messaging.conversation.manage` like anyone else.
  public static readonly EDIT_WINDOW_MS = 15 * 60 * 1000;

  // One signal per conversation per this. A composer that published per keystroke would
  // send forty frames a sentence to every member.
  public static readonly TYPING_INTERVAL_MS = 2_000;

  public static readonly OWNER_ROLE: ConversationMemberRole = "owner";

  // Sorted, so `directKey(a, b)` and `directKey(b, a)` are the same string. That is the
  // whole of what makes opening the same DM twice return one conversation.
  public static directKey(a: UserId, b: UserId): string {
    return a < b ? `${a}_${b}` : `${b}_${a}`;
  }

  public static withinEditWindow(createdAt: Date, now: Date): boolean {
    return now.getTime() - createdAt.getTime() <= MessagingRules.EDIT_WINDOW_MS;
  }

  public static isOwner(role: ConversationMemberRole): boolean {
    return role === MessagingRules.OWNER_ROLE;
  }
}
