// The single container, end to end: sign up and verify through its own Mailpit, create a
// project and an API key, analyze a fixture with the CLI and upload it through the proxied
// storage route, read it back through /api/v1, then restart the container and read it again.
//
// Run: node tooling/scripts/container-smoke.mjs <container> [base url] [mailpit url]
// Needs `apps/cli/dist` built. See docs/plans/SELF-HOSTED-PLAN.md, SH6.1.

// @ts-check

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [container, base = "http://localhost:43000", inbox = "http://localhost:48025"] =
  process.argv.slice(2);
if (!container) {
  process.stderr.write("usage: container-smoke.mjs <container> [base url] [mailpit url]\n");
  process.exit(2);
}

/** @param {string} name @param {boolean} ok @param {string} [detail] */
const step = (name, ok, detail = "") => {
  process.stdout.write(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}\n`);
  if (!ok) process.exit(1);
};
const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));
// A response's JSON, loosely typed: this script checks shapes by asserting on them.
const jsonOf = async (/** @type {Response} */ r) =>
  /** @type {Record<string, any>} */ (await r.json());

const healthy = async () => {
  for (let i = 0; i < 120; i++) {
    const status = await fetch(`${base}/api/health`).then(
      (r) => r.status,
      () => 0,
    );
    if (status === 200) return true;
    await sleep(2000);
  }
  return false;
};

const account = {
  email: `smoke-${Date.now()}@example.test`,
  password: randomBytes(18).toString("base64url"),
};
const headers = { "content-type": "application/json", origin: base };

step("healthy", await healthy());

let response = await fetch(`${base}/api/auth/sign-up/email`, {
  method: "POST",
  headers,
  body: JSON.stringify({ name: "Smoke Test", email: account.email, password: account.password }),
});
step("sign up", response.ok, String(response.status));

/** @type {string | null} */
let link = null;
for (let i = 0; i < 30 && !link; i++) {
  await sleep(1000);
  const query = encodeURIComponent(`to:${account.email}`);
  const list = await jsonOf(await fetch(`${inbox}/api/v1/search?query=${query}`));
  const id = list.messages?.[0]?.ID;
  if (id) {
    const message = await jsonOf(await fetch(`${inbox}/api/v1/message/${id}`));
    link = String(message.Text ?? "").match(/https?:\/\/\S+verify-email\S*/)?.[0] ?? null;
  }
}
step("verification mail arrives in the container's Mailpit", link !== null);
response = await fetch(/** @type {string} */ (link), { redirect: "manual" });
step("verify the address", response.status < 400, String(response.status));

const signIn = async () => {
  const r = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers,
    body: JSON.stringify(account),
  });
  return {
    ok: r.ok,
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
};
let session = await signIn();
step("sign in", session.ok);

/** @param {string} path @param {unknown} body */
const rpc = async (path, body) => {
  const r = await fetch(`${base}/api/rpc/${path}`, {
    method: "POST",
    headers: { ...headers, cookie: session.cookie },
    body: JSON.stringify({ json: body }),
  });
  return { status: r.status, json: (await jsonOf(r)).json };
};

const slug = `smoke-${Date.now().toString(36)}`;
const project = await rpc("project/create", {
  name: "Smoke",
  slug,
  description: null,
  visibility: "org",
  defaultRole: "project_editor",
  repositories: [],
});
step("create a project", project.status === 200, String(project.status));
const key = await rpc("apiKey/create", {
  name: "smoke",
  scopes: ["project.graph.read", "project.scan.run", "member.read"],
  expiresAt: null,
});
step("create an API key", key.status === 200 && typeof key.json?.token === "string");

execFileSync(
  process.execPath,
  [
    join(ROOT, "apps/cli/dist/index.js"),
    "scan",
    join(ROOT, "packages/analyzer/tests/fixture/nestjs"),
    "--name",
    "acme/api",
    "--project",
    slug,
    "--server",
    base,
    "--api-key",
    key.json.token,
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
step("the CLI analyzes and uploads through /api/storage", true);

const auth = { authorization: `Bearer ${key.json.token}` };
const readBack = async () => {
  const projectUrl = `${base}/api/v1/projects/${project.json.id}`;
  const routes = await jsonOf(await fetch(`${projectUrl}/routes`, { headers: auth }));
  const graph = await jsonOf(await fetch(`${projectUrl}/graph`, { headers: auth }));
  const gzipped = Buffer.from(await (await fetch(graph.url)).arrayBuffer());
  const document = JSON.parse(gunzipSync(gzipped).toString("utf8"));
  return {
    routes: routes.routes?.length ?? 0,
    url: String(graph.url),
    files: document.files.length,
  };
};
const before = await readBack();
step("read routes back through /api/v1", before.routes > 0, `${before.routes} routes`);
step(
  "the graph link is the app's, not the bucket's",
  before.url.startsWith(`${base}/api/storage/`),
);
step("download the graph through it", before.files > 0, `${before.files} files`);

execFileSync("docker", ["restart", container], { stdio: "ignore" });
step("healthy again after a restart", await healthy());
session = await signIn();
const after = await readBack();
step("the account, project and graph survive", session.ok && after.files === before.files);
