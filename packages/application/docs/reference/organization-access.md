---
title: Organization access
description: Wiremap's additions to who is in an organization and how they got there — the viewer role, removal, shareable links, auto-join domains, teams, ownership transfer, deletion and the audit log.
---

# Organization access

The kit already handles organizations, email invitations, roles and overrides. Wiremap adds the
pieces below. Each one asserts its own key, and none adds a new way past the three visibility
mechanisms.

## Roles

| Role | Holds |
|---|---|
| `owner` | every tenant key, including `organization.ownership.transfer` and `organization.delete` |
| `admin` | members, invitations, teams, domains, the organization's name, the audit log |
| `member` | reading members, notifications, docs |
| `viewer` | the same organization-wide keys as `member`. The two part at projects, where a viewer is capped at reading |
| `guest` | nothing. Kept as the kit's seam, not offered in the role picker |

Migration `0004_wiremap_access.sql` adds `viewer` to every existing organization and grants the new
keys to the system roles. `SystemRoleSeed` does the same for an organization founded later.

## Removing a member

`RemoveMemberUseCase` (`member.remove`) ends the membership, where deactivation only pauses it.
It applies the same three guards as deactivation:

- you cannot remove yourself;
- you cannot remove someone whose role holds a key you lack;
- you cannot remove the last owner. This count is taken under a lock inside the transaction.

The repository also deletes the person's goal (project) rows, team places and overrides in that
tenant, so no grant outlives the membership. The audit trail keeps its rows.

## Shareable invitation links

An invitation without an address. `CreateInvitationLinkUseCase` (`member.invite`) stores only the
token's digest and answers the token once. Like an emailed invitation, the role is capped by the
creator's own keys.

A link stops working when it expires, runs out of uses, or is revoked. The claim
(`PgInvitationLinkClaimer`, behind `POST /api/auth/invitation-link/accept`) runs under the same
advisory lock as every enrolment, and needs a **verified** address. The link row is locked
`for update`, so two people cannot both redeem its last use. Someone already a member gets the
organization opened for them without spending a use.

## Auto-join domains

`AddMemberDomainUseCase` (`member.domain.manage`) claims an email domain. It refuses three things,
each a way a stranger would otherwise walk in:

| Refusal | Answer |
|---|---|
| a public mail provider (a frozen list in `MemberDomainRules`) | `BAD_REQUEST`, rule `publicDomain` |
| a domain the claimant has no **verified** address at | `BAD_REQUEST`, rule `notYourDomain` |
| a domain another organization already holds | `CONFLICT` |

At enrolment, the chain is: a pending invitation, then a claimed domain (`DomainJoiningEnroller`),
then the mode's own answer. A verified newcomer at a claimed domain therefore joins that
organization instead of founding one. `organization_domains_domain_uq` is one of the exempt
indexes that cannot lead with the tenant (`docs/opinions/vocabulary.md`).

## Teams

A team is a named group of members, and **grants nothing on its own**. A project that names it
grants its members that project's role (`WM4.5`). Names are unique per organization, compared
case-insensitively. Adding or removing someone drops that person's cached capabilities. Deleting a
team drops the organization's, because its project grants leave with it.

## Ownership transfer

`TransferOwnershipUseCase` hands the tenant to another **active** member in one transaction: the
target becomes `owner` and the caller becomes `admin`. There is never a moment with two owners or
with none. Only an owner can do it, checked by role and not only by key.

## Deleting the organization

`RemoveOrganizationUseCase` (`organization.delete`) is the owner's version of the platform's
delete. The slug is typed back and compared on the server. The platform tier is refused. The same
`tenant-delete` maintenance job does the work, placed on the tenant's node.

## The audit log

`ListActivityUseCase` (`audit.log.read`) pages `activity_log` newest first by keyset, filtered by
action, actor and time. The trail is `local` and names are `catalog`, so the reader returns actor
ids and the use-case resolves every name on the page in one `UserReader` call. The same reader,
filtered by `payload->>'projectId'`, will feed the project activity page.
