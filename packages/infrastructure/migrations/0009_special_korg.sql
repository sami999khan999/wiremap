-- Hand-edited after `drizzle-kit generate`: the delete below is what lets the last
-- statement succeed on a database that already has rows.
--
-- Every tenant foreign key now cascades. Before this, `roles`, `memberships`,
-- `role_permissions`, `goal_members` and `permission_overrides` were `NO ACTION` while
-- `api_keys`, `sessions` and `invitations` cascaded — so `DELETE FROM organizations`
-- could never succeed, although `users.last_active_organization_id` is `SET NULL` for
-- exactly that case. `document_chunks` had no foreign key at all, so a deleted tenant
-- would have left its corpus behind: embeddings nothing can reach and nothing removes.

ALTER TABLE "goal_members" DROP CONSTRAINT "goal_members_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "permission_overrides" DROP CONSTRAINT "permission_overrides_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT "roles_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "goal_members" ADD CONSTRAINT "goal_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Ahead of the constraint, not after it: `document_chunks` has been writable with no
-- foreign key since 0000, so a chunk whose tenant is gone is exactly what this table can
-- hold. Such a row is unreachable — every read is scoped by `organization_id` — and the
-- `ADD CONSTRAINT` below is a full validation that would fail on it.
DELETE FROM "document_chunks" WHERE "organization_id" NOT IN (SELECT "id" FROM "organizations");--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
