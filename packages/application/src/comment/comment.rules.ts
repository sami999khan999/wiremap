import type { UserId } from "../import.js";

const MENTION = /@\[([0-9a-f-]{36})\]/g;

// How a body names people: `@[<userId>]`, written by the mention picker and rendered as a
// name. Free-text `@ada` mentions nobody, so a typo never notifies a stranger.
export class CommentRules {
  private constructor() {}

  public static readonly MAX_MENTIONS = 50;

  public static mentions(body: string): UserId[] {
    return [...new Set([...body.matchAll(MENTION)].map((match) => match[1] as UserId))].slice(
      0,
      CommentRules.MAX_MENTIONS,
    );
  }

  // A notification's preview: mentions as `@someone`, whitespace collapsed, capped.
  public static excerpt(body: string): string {
    return body.replace(MENTION, "@someone").replace(/\s+/g, " ").trim().slice(0, 200);
  }
}
