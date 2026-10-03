#!/usr/bin/env node
// Builds the environment every service in the container runs with, and writes it to
// /run/wiremap/env. Order of precedence: what the container was started with, then the
// secrets generated on first start (/data/secrets.env), then the fixed internal defaults.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DATA = process.env.WIREMAP_DATA ?? "/data";
const SECRETS = `${DATA}/secrets.env`;
const OUT = "/run/wiremap/env";

const parse = (text) =>
  Object.fromEntries(
    text
      .split("\n")
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
const hex = (bytes) => randomBytes(bytes).toString("hex");

// Generated once and kept: losing SECRET_ENCRYPTION_KEY makes every stored key unreadable,
// and losing the database password locks the app out of its own data.
const generated = existsSync(SECRETS) ? parse(readFileSync(SECRETS, "utf8")) : {};
const wanted = {
  POSTGRES_PASSWORD: () => hex(24),
  MINIO_PASSWORD: () => hex(24),
  AUTH_SECRET: () => hex(32),
  STORAGE_URL_SECRET: () => hex(32),
  WIREMAP_RUNNER_SECRET: () => hex(32),
  SECRET_ENCRYPTION_KEY: () => hex(32),
};
let changed = false;
for (const [key, make] of Object.entries(wanted)) {
  if (!generated[key]) {
    generated[key] = make();
    changed = true;
  }
}
if (changed) {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(
    SECRETS,
    `# Generated on first start. Keep it with the data: it decrypts what is stored.\n${Object.entries(
      generated,
    )
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
    { mode: 0o600 },
  );
}

const given = (key) => (process.env[key] && process.env[key] !== "" ? process.env[key] : undefined);
const secret = (key) => given(key) ?? generated[key];
// Compose runs the stores as their own containers and hands their URLs in.
const external = given("WIREMAP_EXTERNAL_STORES") === "1";
const publicUrl = (given("WIREMAP_PUBLIC_URL") ?? "http://localhost:43000").replace(/\/+$/, "");
const smtpGiven = given("SMTP_URL");

const env = {
  NODE_ENV: "production",
  ENV: "production",
  LOG_LEVEL: given("LOG_LEVEL") ?? "info",
  PORT: "43000",
  HOST: "0.0.0.0",
  WEB_PROCESSES: given("WEB_PROCESSES") ?? "2",

  WIREMAP_EXTERNAL_STORES: external ? "1" : "0",
  DATABASE_URL:
    (external && given("DATABASE_URL")) ||
    `postgres://wiremap:${secret("POSTGRES_PASSWORD")}@127.0.0.1:5432/wiremap`,
  DATABASE_DIRECT_URL:
    (external && (given("DATABASE_DIRECT_URL") ?? given("DATABASE_URL"))) ||
    `postgres://wiremap:${secret("POSTGRES_PASSWORD")}@127.0.0.1:5432/wiremap`,
  DATABASE_POOL_MAX: given("DATABASE_POOL_MAX") ?? "10",
  POSTGRES_PASSWORD: secret("POSTGRES_PASSWORD"),
  REDIS_CACHE_URL: (external && given("REDIS_CACHE_URL")) || "redis://127.0.0.1:6379",
  REDIS_QUEUE_URL: (external && given("REDIS_QUEUE_URL")) || "redis://127.0.0.1:6379",

  S3_ENDPOINT: (external && given("S3_ENDPOINT")) || "http://127.0.0.1:9000",
  S3_REGION: (external && given("S3_REGION")) || "us-east-1",
  S3_BUCKET: (external && given("S3_BUCKET")) || "wiremap",
  S3_ACCESS_KEY: (external && given("S3_ACCESS_KEY")) || "wiremap",
  S3_SECRET_KEY: (external && given("S3_SECRET_KEY")) || secret("MINIO_PASSWORD"),
  MINIO_PASSWORD: secret("MINIO_PASSWORD"),
  S3_FORCE_PATH_STYLE: "true",
  S3_CHECKSUMS: "full",
  S3_LIFECYCLE: "true",
  S3_ACCESS: "proxied",
  STORAGE_URL_SECRET: secret("STORAGE_URL_SECRET"),

  SMTP_URL: smtpGiven ?? "smtp://127.0.0.1:1025",
  EMAIL_FROM: given("EMAIL_FROM") ?? "wiremap <no-reply@localhost>",
  WIREMAP_MAILPIT: smtpGiven || external ? "0" : "1",

  APP_BASE_URL: publicUrl,
  AUTH_URL: publicUrl,
  AUTH_TRUSTED_ORIGINS: given("AUTH_TRUSTED_ORIGINS") ?? publicUrl,
  AUTH_SECRET: secret("AUTH_SECRET"),
  AUTH_ENROLMENT_MODE: given("AUTH_ENROLMENT_MODE") ?? "personal",
  AUTH_REQUIRE_EMAIL_VERIFICATION: given("AUTH_REQUIRE_EMAIL_VERIFICATION") ?? "true",
  AUTH_SESSION_MAX_AGE_SECONDS: given("AUTH_SESSION_MAX_AGE_SECONDS") ?? "604800",
  AUTH_COOKIE_CACHE_MAX_AGE_SECONDS: given("AUTH_COOKIE_CACHE_MAX_AGE_SECONDS") ?? "60",

  QUEUE_DRIVER: "bullmq",
  REALTIME_DRIVER: "none",
  SCAN_RUNNER: "local",
  WIREMAP_CLI_PATH: "/app/cli/index.js",
  WIREMAP_RUNNER_SECRET: secret("WIREMAP_RUNNER_SECRET"),
  SECRET_ENCRYPTION_KEY: secret("SECRET_ENCRYPTION_KEY"),
  SECRET_ENCRYPTION_KEY_VERSION: given("SECRET_ENCRYPTION_KEY_VERSION") ?? "v1",
};

// Everything else the person passed (the GitHub App, Google sign-in, the tunnel token,
// tuning keys) goes through unchanged.
for (const [key, value] of Object.entries(process.env)) {
  if (
    /^[A-Z][A-Z0-9_]*$/.test(key) &&
    !(key in env) &&
    value !== "" &&
    !/^(S6_|HOME|PATH|HOSTNAME|PWD|SHLVL|TERM|_)/.test(key)
  ) {
    env[key] = value;
  }
}

mkdirSync("/run/wiremap", { recursive: true });
writeFileSync(
  OUT,
  `${Object.entries(env)
    // Single-quoted for `source`: nothing inside is expanded, so a `$` in a password stays.
    .map(([key, value]) => `${key}='${String(value).replaceAll("'", "'\\''")}'`)
    .join("\n")}\n`,
  { mode: 0o600 },
);
chmodSync(OUT, 0o600);
process.stdout.write(
  `wiremap: environment ready (${Object.keys(env).length} keys), public at ${publicUrl}\n`,
);
