import type { RoleRecord } from "@loadbearing/application";
import { Identifiers, type OrganizationId, type UserId } from "@loadbearing/contracts";
import { SystemClock, Uuid } from "@loadbearing/core";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgActivityLogger } from "../../src/pg/repository/pg-activity.logger.js";
import { PgOrganizationFounder } from "../../src/pg/repository/pg-organization.founder.js";
import { PgRoleRepository } from "../../src/pg/repository/pg-role.repository.js";
import {
  memberships,
  organizations,
  rolePermissions,
  roles,
  users,
} from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";
import { RecordingLogger } from "../support/recording.logger.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

let database: Database;
let repository: PgRoleRepository;

// Two organizations, because a repository that cannot be shown to stop at a tenant
// boundary has not been tested — only exercised.
const createdUsers: UserId[] = [];
const createdOrgs: OrganizationId[] = [];
let here: OrganizationId;
let elsewhere: OrganizationId;

const makeUser = async () => {
  const id = Identifiers.userId.parse(Uuid.v7());
  await database.client
    .insert(users)
    .values({ id, name: "Ada", email: `${id}@example.test`, emailVerified: true });
  createdUsers.push(id);
  return id;
};

const makeOrganization = async (slug: string) => {
  const scope = new TransactionScope();
  const founder = new PgOrganizationFounder(
    DatabaseCluster.single(database),
    scope,
    shards,
    new PgActivityLogger(DatabaseCluster.single(database), scope, shards, new SystemClock()),
    new RecordingLogger(),
  );
  const id = await founder.found(await makeUser(), "Role repository target", slug);
  createdOrgs.push(id);
  return id;
};

const draft = (overrides: Partial<RoleRecord> = {}): RoleRecord => ({
  id: Identifiers.roleId.parse(Uuid.v7()),
  key: `reviewer-${Uuid.v7()}`,
  name: "Reviewer",
  description: null,
  scope: "org",
  isSystem: false,
  permissions: [],
  ...overrides,
});

beforeAll(async () => {
  database = openDatabase();
  repository = new PgRoleRepository(
    DatabaseCluster.single(database),
    new TransactionScope(),
    shards,
  );
  here = await makeOrganization(`role-repo-here-${Uuid.v7()}`);
  elsewhere = await makeOrganization(`role-repo-there-${Uuid.v7()}`);
});

afterAll(async () => {
  for (const id of createdOrgs) {
    await database.client.delete(memberships).where(eq(memberships.organizationId, id));
    await database.client.delete(rolePermissions).where(eq(rolePermissions.organizationId, id));
    await database.client.delete(roles).where(eq(roles.organizationId, id));
    await database.client.delete(organizations).where(eq(organizations.id, id));
  }
  if (createdUsers.length > 0) {
    await database.client.delete(users).where(inArray(users.id, createdUsers));
  }
  await database.close();
});

describe("PgRoleRepository writes", () => {
  it("saves a new role and reads it back with its grants", async () => {
    const role = draft({ permissions: ["member.read", "rbac.role.read"] });
    await repository.save(here, role);

    const read = await repository.findById(here, role.id);

    expect(read?.name).toBe("Reviewer");
    expect(read?.isSystem).toBe(false);
    // Sorted by the repository, so two runs against the same rows agree.
    expect(read?.permissions).toEqual(["member.read", "rbac.role.read"]);
  });

  // The reconcile is the whole point of one `save`: a record with a grant removed must
  // leave the table without it, not merely fail to add it again.
  it("reconciles grants down as well as up", async () => {
    const role = draft({ permissions: ["member.read", "rbac.role.read"] });
    await repository.save(here, role);

    await repository.save(here, { ...role, name: "Auditor", permissions: ["rbac.role.read"] });

    const read = await repository.findById(here, role.id);
    expect(read?.name).toBe("Auditor");
    expect(read?.permissions).toEqual(["rbac.role.read"]);
  });

  it("empties a role's grants when the record carries none", async () => {
    const role = draft({ permissions: ["member.read"] });
    await repository.save(here, role);

    await repository.save(here, { ...role, permissions: [] });

    expect((await repository.findById(here, role.id))?.permissions).toEqual([]);
  });

  // The `delete … not in (…)` is scoped by role as well as by tenant. Without the role
  // predicate, saving one role would strip every other role in the organization.
  it("leaves a sibling role's grants alone", async () => {
    const kept = draft({ permissions: ["member.read"] });
    const edited = draft({ permissions: ["member.read"] });
    await repository.save(here, kept);
    await repository.save(here, edited);

    await repository.save(here, { ...edited, permissions: [] });

    expect((await repository.findById(here, kept.id))?.permissions).toEqual(["member.read"]);
  });

  it("finds a role by the key its tenant's unique index is on", async () => {
    const role = draft();
    await repository.save(here, role);

    expect((await repository.findByKey(here, role.key))?.id).toBe(role.id);
    // The same key, asked for under the other tenant. `roles_key_uq` leads with the
    // organization precisely so both may hold one.
    expect(await repository.findByKey(elsewhere, role.key)).toBeNull();
  });

  it("deletes a role and the grants that hang off it", async () => {
    const role = draft({ permissions: ["member.read"] });
    await repository.save(here, role);

    await repository.delete(here, role.id);

    expect(await repository.findById(here, role.id)).toBeNull();
    const orphans = await database.client
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, role.id));
    expect(orphans).toEqual([]);
  });

  // A delete narrowed only by id would reach across the boundary the moment an id leaked.
  it("does not delete a role through another tenant", async () => {
    const role = draft();
    await repository.save(here, role);

    await repository.delete(elsewhere, role.id);

    expect(await repository.findById(here, role.id)).not.toBeNull();
  });

  it("counts nobody for a role nobody holds", async () => {
    const role = draft();
    await repository.save(here, role);

    expect(await repository.countAssignments(here, role.id)).toBe(0);
  });

  // `memberships.role_id` is `on delete no action`, so this count is the only thing
  // standing between a delete and a driver error the UI cannot render.
  it("counts a membership that holds the role", async () => {
    const role = draft();
    await repository.save(here, role);
    await database.client.insert(memberships).values({
      id: Uuid.v7(),
      organizationId: here,
      userId: await makeUser(),
      roleId: role.id,
    });

    expect(await repository.countAssignments(here, role.id)).toBe(1);
  });
});
