import type { GithubAppRecord, GithubAppRepository, Placement } from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { githubApps } from "../schema/index.js";

// The singleton's id, as `platform_policy` has one: the check constraint allows no other.
const ROW = 1;

export class PgGithubAppRepository extends BaseRepository implements GithubAppRepository {
  // Deployment-wide, read by every process before a tenant is known.
  protected override readonly placement: Placement = "catalog";

  public async find(): Promise<GithubAppRecord | null> {
    const rows = await this.db
      .select({
        appId: githubApps.appId,
        slug: githubApps.slug,
        htmlUrl: githubApps.htmlUrl,
        ownerLogin: githubApps.ownerLogin,
        clientId: githubApps.clientId,
        encryptedPrivateKey: githubApps.encryptedPrivateKey,
        encryptedWebhookSecret: githubApps.encryptedWebhookSecret,
        encryptedClientSecret: githubApps.encryptedClientSecret,
      })
      .from(githubApps)
      .limit(1);
    return rows[0] ?? null;
  }

  public async save(record: GithubAppRecord): Promise<void> {
    await this.db
      .insert(githubApps)
      .values({ id: ROW, ...record })
      .onConflictDoUpdate({ target: githubApps.id, set: record });
  }

  public async delete(): Promise<void> {
    await this.db.delete(githubApps);
  }
}
