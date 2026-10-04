import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GithubAppRecord } from "../../src/import.js";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgGithubAppRepository } from "../../src/pg/repository/pg-github-app.repository.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";

let database: Database;
// The row is the deployment's, so whatever a developer's database holds is put back after.
let before: GithubAppRecord | null = null;

const repository = () =>
  new PgGithubAppRepository(
    DatabaseCluster.single(database),
    new TransactionScope(),
    new ShardScope(),
  );

const record = (slug: string): GithubAppRecord => ({
  appId: "42",
  slug,
  htmlUrl: `https://github.com/apps/${slug}`,
  ownerLogin: "octo",
  clientId: "Iv23client",
  encryptedPrivateKey: "v1:key",
  encryptedWebhookSecret: "v1:hook",
  encryptedClientSecret: "v1:client",
});

beforeAll(async () => {
  database = openDatabase();
  before = await repository().find();
  await repository().delete();
});

afterAll(async () => {
  await repository().delete();
  if (before) await repository().save(before);
  await database.close();
});

describe("PgGithubAppRepository", () => {
  it("holds one App: a second save replaces the first, and delete leaves none", async () => {
    expect(await repository().find()).toBeNull();

    await repository().save(record("wiremap-first"));
    await repository().save(record("wiremap-second"));
    expect(await repository().find()).toEqual(record("wiremap-second"));

    await repository().delete();
    expect(await repository().find()).toBeNull();
  });

  it("refuses a second row at the database, not only in the repository", async () => {
    await expect(
      database.client.execute(
        sql`insert into github_apps (id, app_id, slug, html_url, owner_login, client_id,
          encrypted_private_key, encrypted_webhook_secret, encrypted_client_secret)
          values (2, '1', 's', 'u', 'o', 'c', 'k', 'w', 'x')`,
      ),
    ).rejects.toThrow();
  });
});
