---
title: Comments
description: Threads on a project's files, folders and routes, mentions, notes, and the project feed
---

# Comments

`ManageCommentsUseCase` keeps conversations attached to a project's graph. A comment targets a
file, a folder, a route or the project itself. Its key is a path, a route id such as
`GET /users`, or `""` for the project.

## One level of threads

A reply names its parent, and a reply never has replies of its own. A reply to a reply joins
its parent's root, and it takes the root's target whatever the client sent. The UI then
needs no recursion, and a thread cannot drift away from the node it started on.

## Bodies are text

The body is plain text, rendered as text and never as HTML. A mention is the only thing in it
that renders as anything else. It is stored as `@[<userId>]`, so renaming a person renames
every mention of them. The composer shows `@Name` while typing and swaps it on submit.

Text, not Markdown, is a deliberate cut. A sanitiser is a second parser that has to agree
with the renderer forever. Nothing a comment needs to say requires markup.

## Who may do what

| Act | Needs |
|---|---|
| Read the thread | `project.graph.read` on the project |
| Write, reply, resolve, pin | `project.comment.write` (owner, admin, project admin, project editor) |
| Edit | being the author |
| Delete | being the author, or `project.settings.manage` on the project |

Deleting a comment is soft. The row stays so its replies keep their thread, but it is no
longer read and it loses its pin. The project purge removes every comment for real.

## Mentions and replies notify

`comment.created` is published in the same transaction as the row. It carries the mentioned
users and the root's author, when a reply arrives on someone else's thread.
`NotificationPolicy`'s `named` rule delivers it. It drops the author, and it drops anyone
`NotificationAccess.readsProject` says cannot read the project. A mention cannot be used to
tell someone that a restricted project exists.

`NotificationAccess` is a port because the answer is the capability set, which sits behind
`CapabilityCache` in `auth`. The read happens before delivery's transaction, as a catalog read
must.

## Notes

A pinned root comment is a note. The canvas marks it with a pin, and the overview lists every
note. The canvas mark on a node counts its open comments, and the count is added to every
folder above it. A collapsed folder therefore still shows the conversation inside it.

## The project feed

`ListProjectActivityUseCase` reads `activity_log` for rows whose payload names the project.
Creating and deleting a comment both write a row, beside every other project action.
`activity_log_project_idx` on `(organization_id, payload->>'projectId', occurred_at)` serves
the read. Anyone who reads the project reads its feed, which is why the feed is not gated on
`audit.log.read`.
