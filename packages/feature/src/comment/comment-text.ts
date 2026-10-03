import type { CommentDto } from "../import.js";

export type CommentPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "mention"; readonly userId: string };

export interface CommentMark {
  readonly count: number;
  readonly pinned: boolean;
}

const MENTION = /@\[([0-9a-f-]{36})\]/g;

// A comment's body as text and mentions, and the per-node marks the canvas draws. The
// stored form is `@[<userId>]`; the composer writes `@Name` and swaps it on the way out.
export class CommentText {
  private constructor() {}

  public static parts(body: string): readonly CommentPart[] {
    const parts: CommentPart[] = [];
    let at = 0;
    for (const match of body.matchAll(MENTION)) {
      if (match.index > at) parts.push({ kind: "text", text: body.slice(at, match.index) });
      parts.push({ kind: "mention", userId: match[1] ?? "" });
      at = match.index + match[0].length;
    }
    if (at < body.length) parts.push({ kind: "text", text: body.slice(at) });
    return parts;
  }

  // Longest name first, so `@Ann Lee` is not taken as `@Ann` followed by text.
  public static encode(draft: string, chosen: ReadonlyMap<string, string>): string {
    let body = draft;
    for (const [name, userId] of [...chosen].sort((a, b) => b[0].length - a[0].length)) {
      body = body.split(`@${name}`).join(`@[${userId}]`);
    }
    return body;
  }

  public static decode(body: string, people: ReadonlyMap<string, string>): string {
    return body.replace(MENTION, (_, userId: string) => `@${people.get(userId) ?? userId}`);
  }

  // The partial name after an `@` the caret sits in, or null when it sits in none.
  public static query(draft: string, caret: number): string | null {
    const match = /(?:^|\s)@([^\s@[\]]{0,30})$/.exec(draft.slice(0, caret));
    return match ? (match[1] ?? "") : null;
  }

  // Each mark is added to its node and every folder above it, so a collapsed folder still
  // shows the conversation inside it.
  public static marks(comments: readonly CommentDto[]): ReadonlyMap<string, CommentMark> {
    const marks = new Map<string, CommentMark>();
    for (const comment of comments) {
      if (comment.target.kind === "project" || comment.target.kind === "route") continue;
      const segments = comment.target.key.split("/");
      for (let depth = segments.length; depth > 0; depth--) {
        const key = segments.slice(0, depth).join("/");
        const mark = marks.get(key) ?? { count: 0, pinned: false };
        marks.set(key, {
          count: mark.count + (comment.resolvedAt ? 0 : 1),
          pinned: mark.pinned || comment.pinned,
        });
      }
    }
    return marks;
  }
}
