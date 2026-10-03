import { Client } from "pg";
// A relative import across the repo, which `tests/` may do and `src/` may not: naming
// `@loadbearing/scripts` would put a tooling package in an app's manifest.
// @ts-expect-error — a plain `.mjs` helper with no declaration file beside it.
import { bootApp, freePort } from "../../../../../tooling/scripts/boot-app.mjs";

const ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// Every address this suite creates. The sweep is keyed on it, so a run killed half way
// through cannot leave a half-verified user for the next one to collide with.
export const SMOKE_DOMAIN = "web-smoke.test";

interface Booted {
  readonly stop: () => void;
}

const booted: Booted[] = [];

// **These override the ambient environment rather than filling gaps in it**, and that
// is the whole point: the suite's behaviour is its own, not whatever `.env` happens to
// ──
// say on the machine running it. A developer with `AUTH_ENROLMENT_MODE=bootstrap` set
// would otherwise get a member of the seeded tenant where the specs expect a founder.
const DECIDED = {
  AUTH_SECRET: "web-smoke-secret-at-least-thirty-two-characters",
  AUTH_SESSION_MAX_AGE_SECONDS: "604800",
  AUTH_DESKTOP_SESSION_MAX_AGE_SECONDS: "2592000",
  AUTH_COOKIE_CACHE_MAX_AGE_SECONDS: "60",
  // Both load-bearing. Verification is what makes the mail leg real, and `personal`
  // makes each sign-up the owner of its own tenant — so a spec can invite.
  AUTH_REQUIRE_EMAIL_VERIFICATION: "true",
  AUTH_ENROLMENT_MODE: "personal",
  EMAIL_FROM: "smoke@web-smoke.test",
  EMBEDDING_MODEL: "text-embedding-3-small",
  EMBEDDING_DIMENSIONS: "1536",
  // The kept seams this suite exercises: the stream it reads a frame from, and the BullMQ
  // worker it boots. Wiremap's own deployment runs `none` and `cloudflare` instead.
  REALTIME_DRIVER: "redis",
  QUEUE_DRIVER: "bullmq",
};

// **`LOG_LEVEL` is deliberately not here.** The worker is waited on by a line it emits
// at `info`, and quietening the process you are watching waits out the whole timeout.
// ──
// Everything else — database, both Redis instances, S3, SMTP — is inherited: those are
// the running stack's, and a suite that invented them would be testing itself.
const childEnv = (port: number): NodeJS.ProcessEnv => ({
  ...process.env,
  ...DECIDED,
  PORT: String(port),
  // Built from the port the kernel just handed out, so all three agree — a mismatch
  // here is a sign-in that sets a cookie the next request does not send.
  AUTH_URL: `http://127.0.0.1:${port}`,
  APP_BASE_URL: `http://127.0.0.1:${port}`,
  AUTH_TRUSTED_ORIGINS: `http://127.0.0.1:${port}`,
});

let startedAt = new Date();

export default async function setup({
  provide,
}: {
  provide: (key: string, value: unknown) => void;
}) {
  startedAt = new Date();
  const port = (await freePort()) as number;

  // The worker first: a sign-up publishes a mail job, and a job with nobody consuming
  // it is a verification link that never arrives.
  const worker = await bootApp({
    entry: `${ROOT}apps/worker/dist/main.js`,
    started: '"event":"process.started"',
    cwd: ROOT,
    // The web child's env, so a mail's link names the server the spec is signed in to.
    env: childEnv(port),
  });
  booted.push(worker as Booted);

  const web = await bootApp({
    entry: `${ROOT}apps/web/.output/server/index.mjs`,
    // The socket, not Nitro's "Listening on:" line. Under vitest the child's pipes
    // deliver nothing to this process, and a page that answers is the better signal
    // ──
    // anyway: `boot-smoke.mjs` watches the line because it also asserts the line.
    ready: async () => (await fetch(`http://127.0.0.1:${port}/`)).ok,
    cwd: ROOT,
    env: childEnv(port),
  });
  booted.push(web as Booted);

  provide("baseUrl", `http://127.0.0.1:${port}`);

  return async () => {
    for (const each of booted) each.stop();
    await sweep();
  };
}

// The same answer `packages/infrastructure` gives: one sweep, keyed on what this suite
// creates, run whether or not the specs got as far as cleaning up after themselves.
async function sweep(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const like = `%@${SMOKE_DOMAIN}`;

  try {
    await client.connect();

    // **Tenants first, and this is the half that is easy to leave out.** `personal`
    // enrolment founds an organization per sign-up, and one left behind is exactly what
    // ──
    // `23.21` found aborting the projection every five minutes.
    // ──
    // Bounded by this run's own start rather than by a membership join: an organization
    // whose members have already gone is invisible to a join, and no tenant holding a
    // ──
    // non-smoke member is ever in range, so the seeded one cannot be reached.
    const orphaned = await client.query<{ id: string }>(
      `select o.id from organizations o
         where o.created_at >= $2
           and not exists (select 1 from memberships m join users u on u.id = m.user_id
                            where m.organization_id = o.id and u.email not like $1)`,
      [like, startedAt],
    );

    const ids = orphaned.rows.map((row) => row.id);
    if (ids.length > 0) {
      // The placement goes with it. Nothing cascades here: `shard_assignments` is keyed
      // on a text shard key and carries no foreign key, by design.
      await client.query("delete from shard_assignments where shard_key = any($1::text[])", [ids]);
      await client.query("delete from organizations where id = any($1::uuid[])", [ids]);
    }

    // Better Auth's own tables carry no foreign key back to `users`, so these are
    // ordered by dependency rather than left to a cascade.
    await client.query(
      "delete from sessions where user_id in (select id from users where email like $1)",
      [like],
    );
    await client.query("delete from verifications where identifier like $1", [like]);
    await client.query(
      "delete from accounts where user_id in (select id from users where email like $1)",
      [like],
    );
    await client.query("delete from users where email like $1", [like]);
  } finally {
    await client.end();
  }
}
