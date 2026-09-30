CREATE INDEX "api_keys_issuer_fk_idx" ON "api_keys" USING btree ("issuer_id");--> statement-breakpoint
CREATE INDEX "goal_members_user_fk_idx" ON "goal_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "permission_overrides_user_fk_idx" ON "permission_overrides" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "role_permissions_role_fk_idx" ON "role_permissions" USING btree ("role_id");