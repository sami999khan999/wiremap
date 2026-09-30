export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // A closed list, so "which package does this change belong to?" is answered at
    // commit time. Add a package, add its scope here — a rejected commit is the reminder.
    "scope-enum": [
      2,
      "always",
      [
        "errors",
        "core",
        "permissions",
        "observability",
        "contracts",
        "application",
        "infrastructure",
        "auth",
        "composition",
        "asset",
        "content",
        "api-client",
        "api-server",
        "query",
        "ui",
        "feature",
        "web",
        "worker",
        "realtime",
        "desktop",
        "tooling",
        "infra",
        "docs",
        "deps",
        "repo",
      ],
    ],
    "scope-empty": [2, "never"],
  },
};
