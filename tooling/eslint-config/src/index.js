import tseslint from "typescript-eslint";

const OOP_PACKAGES = [
  "packages/{core,permissions,errors,observability,contracts,application,infrastructure,auth,composition,api-server,api-client,asset,content}/src/**/*.ts",
];

const LAZY_MESSAGE =
  "Never lazy-load by permission (docs/opinions/visibility.md, rule 9). The bundle is not a secret, so a lazy() hides nothing and adds a waterfall to the allowed path. Route splitting is the router's.";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.output/**",
      "**/migrations/**",
      // Build configs at a package root — outside every tsconfig `include`, so a
      // type-aware rule fails to parse them. Scoped to one directory below the workspace
      // root rather than "**/*.config.ts": that wider glob also swallowed
      // `packages/*/src/**/*.config.ts`, which *is* inside `include` and is ordinary
      // source. Deliberately not "*.config.*" either — that matches eslint.config.js.
      "*.config.ts",
      "*.config.mts",
      "{packages,apps,tooling}/*/*.config.ts",
      "{packages,apps,tooling}/*/*.config.mts",
      "**/*.d.ts",
      // The analyzer's sample apps: source it reads, never builds, with no dependencies.
      "packages/analyzer/tests/fixture/**",
    ],
  },

  // ── Everything: the typed rules Biome cannot run ──
  {
    files: ["packages/*/src/**/*.{ts,tsx}", "apps/*/src/**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/parameter-properties": ["error", { prefer: "parameter-property" }],
      // Biome owns these; don't double-report.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },

  // ── Non-React packages only: the OOP shape rules ──
  {
    files: OOP_PACKAGES,
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportNamedDeclaration > FunctionDeclaration",
          message: "No exported free functions. Put behaviour on a class (static if stateless).",
        },
        {
          selector:
            "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression",
          message: "No exported arrow functions. Put behaviour on a class (static if stateless).",
        },
        {
          selector: "ExportDefaultDeclaration > FunctionDeclaration",
          message: "No exported free functions. Put behaviour on a class (static if stateless).",
        },
        {
          selector: "ClassBody > PropertyDefinition[static=true][readonly!=true]",
          message: "Static mutable state is banned — it leaks across requests and tests.",
        },
      ],
    },
  },

  // ── feature: bans needing a type-import exemption, which Biome cannot express ──
  {
    files: ["packages/feature/src/**/*.{ts,tsx}"],
    rules: {
      // Off, so the @typescript-eslint variant below owns this rule entirely.
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@loadbearing/api-client",
              allowTypeImports: true,
              message:
                "Every read goes through a defined query in @loadbearing/query. A raw client call inside a component is an uncached read that no invalidation touches.",
            },
            {
              name: "@tanstack/react-router",
              allowTypeImports: true,
              message:
                "Routing lives in apps/web. Pass navigation in as an onNavigate prop or an href string.",
            },
            {
              name: "@loadbearing/content",
              importNames: ["SERVER_CATALOG"],
              message:
                "The email namespace is server-only. Components take a MessageStore; they never build a ContentSource.",
            },
          ],
        },
      ],
    },
  },

  // ── never lazy-load by permission (docs/opinions/visibility.md, rule 9) ──
  // Route splitting is the router's; a component-level lazy() only adds a waterfall.
  {
    files: ["packages/feature/src/**/*.{ts,tsx}", "apps/web/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportDeclaration[source.value='react'] > ImportSpecifier[imported.name='lazy']",
          message: LAZY_MESSAGE,
        },
        {
          selector: "CallExpression[callee.type='Identifier'][callee.name='lazy']",
          message: LAZY_MESSAGE,
        },
        {
          selector: "MemberExpression[object.name='React'][property.name='lazy']",
          message: LAZY_MESSAGE,
        },
      ],
    },
  },

  // ── application throws errors, never status codes (see docs/setup/09) ──
  {
    files: ["packages/application/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@loadbearing/errors",
              importNames: ["HTTP_STATUS"],
              message:
                "A status code is a transport concern. Throw the error; the adapter maps it. That discipline is what keeps the transport swappable.",
            },
          ],
        },
      ],
    },
  },

  // ── email copy is server-only: it exists for apps/worker's digests ──
  {
    files: ["packages/{ui,query}/src/**/*.{ts,tsx}", "apps/web/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@loadbearing/content",
              importNames: ["SERVER_CATALOG"],
              message:
                "The email namespace is server-only. Client code takes the default CLIENT_CATALOG, or BundledContentSource on desktop.",
            },
          ],
        },
      ],
    },
  },

  // ── route files throw redirects, which are not Errors (see docs/setup/24) ──
  //
  // `throw redirect({ to })` is how TanStack Router leaves a `beforeLoad` — the value
  // is a `Redirect`, deliberately, because the router catches it as control flow rather
  // than as a failure. `only-throw-error` is right in general and wrong here, so it is
  // off for the route directory and nowhere else. `src/server/**` keeps it: a transport
  // handler throwing a non-Error is a real bug.
  {
    files: ["apps/*/src/route/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/only-throw-error": "off",
    },
  },

  // ── content may name a module, never a permission (see docs/setup/20) ──
  {
    files: ["packages/content/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@loadbearing/permissions",
              importNames: ["PermissionKey", "PermissionRegistry"],
              message:
                "Content names a module. ModuleRegistry owns which permission gates it. Import ModuleKey as a type instead.",
            },
          ],
        },
      ],
    },
  },
);
