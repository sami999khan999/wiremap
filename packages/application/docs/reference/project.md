---
title: Projects
description: How a project groups repositories, who can open it — the goal scope, org default, direct and team grants, the viewer cap — and how deletion works.
---

# Projects

A project is one or more repositories scanned into a single graph. It lives in the catalog, beside
the capabilities it is checked against (`projects`, `project_repositories`, `project_grants`).

## Access is the goal scope

**A project id is a goal id.** The project keys are `goal`-scoped:

| Key | `project_admin` | `project_editor` | `project_viewer` |
|---|---|---|---|
| `project.graph.read` | ✓ | ✓ | ✓ |
| `project.settings.manage` | ✓ | | |
| `project.access.manage` | ✓ | | |
| `project.delete` | ✓ | | |

Editor and viewer are the same until scans add `project.scan.run` and comments add
`project.comment.write`, both editor keys.

**Org roles that list the keys hold them in every project.** Owner and admin do, so they see every
project, restricted or not. `project.create` is org-scoped: members and admins hold it.

`PgCapabilityRepository.explainFor` reads a member's project grants **in the same one statement
that reads `goal_members`**, so resolution stays at four queries however many projects exist.
A project reaches a member three ways:

1. **Org default:** a project with `visibility = 'org'` gives every member its `default_role`.
2. **Direct grant:** a `project_grants` row naming the user.
3. **Team grant:** a `project_grants` row naming a team the user is in.

Every reached role adds its keys, which is "highest wins" because the roles nest. **An org
`viewer` is capped at `project_viewer`** however the project reaches them (`ProjectRules.capped`).

A deleted project (`deleted_at` set) reaches nobody, at once.

## Not yours is not found

`project.list` returns only projects the caller may read. `project.get` and every write answer
`NOT_FOUND` for a project the caller cannot read, the same as for one that does not exist
(`ProjectAccess.load`). A restricted project's name never leaks.

## Repositories

`project.create` and `project.addRepository` take repositories from
`project.available`, the live list across the organization's GitHub installations. A repository
the installations cannot see is refused. The external id is GitHub's numeric repository id, so a
rename (webhook `repository.renamed`) keeps the link.

## Deleting

`project.remove` soft-deletes and queues `project-delete` on the maintenance queue. The job:
1. deletes every object under `graphs/<organizationId>/<projectId>/`;
2. deletes the row, which cascades repositories and grants;
3. deletes goal-level overrides naming the project.

**The audit trail is kept.** A replayed job removes nothing more, because the purge only deletes a
row that is already marked deleted.
