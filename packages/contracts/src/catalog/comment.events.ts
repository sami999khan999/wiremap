import { z } from "../import.js";
import { Identifiers } from "../primitive/index.js";

// What the comment notifications need: who wrote, where, and whom it names.
export const commentEvents = {
  "comment.created": z.object({
    projectId: Identifiers.projectId,
    commentId: Identifiers.commentId,
    authorId: Identifiers.userId,
    targetKind: z.enum(["file", "folder", "route", "project"]),
    targetKey: z.string().max(1_100),
    // The thread's first comment's author, when this is a reply; null otherwise.
    replyTo: Identifiers.userId.nullable(),
    mentions: z.array(Identifiers.userId).max(50),
    excerpt: z.string().max(200),
  }),
} as const;
