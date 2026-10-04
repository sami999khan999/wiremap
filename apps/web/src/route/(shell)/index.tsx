import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
  buttonClassName,
  type ClientNamespace,
  Icon,
  type IconName,
  RoleDot,
  StatusBadge,
  useMessages,
} from "~/import.js";

// `nav` for this page's own copy; `common` rides in on the root loader.
const MESSAGES = ["nav"] as const satisfies readonly ClientNamespace[];

// Four points, each one icon and a key pair in `nav.landing`.
const POINTS = [
  { icon: "graph", key: "graph", tag: "Imports & Roles" },
  { icon: "route", key: "routes", tag: "Backend & Frontend" },
  { icon: "activity", key: "insights", tag: "Cycles & Dead code" },
  { icon: "sparkle", key: "ask", tag: "Graph-grounded AI" },
] as const satisfies readonly { icon: IconName; key: string; tag: string }[];

// The landing page for a visitor with no session. A signed-in one is sent to the
// dashboard, so every post-sign-in, post-switch and post-create navigation to `/` still lands.
export const Route = createFileRoute("/(shell)/")({
  beforeLoad: ({ context }) => {
    if (context.user) throw redirect({ to: "/dashboard" });
  },
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: Home,
});

// Animated interactive product preview showing the 3-pane Wiremap explorer.
function ProductShowcase() {
  const graphPaths = [
    "M 130 65 C 150 65, 150 35, 175 35",
    "M 130 65 C 150 65, 150 125, 175 125",
    "M 130 185 C 150 185, 150 205, 175 205",
    "M 285 125 C 305 125, 305 145, 325 145",
    "M 285 205 C 305 205, 305 145, 325 145",
    "M 385 175 C 385 195, 385 195, 385 215",
  ];

  return (
    <div className="relative w-full rounded-xl border border-border bg-surface shadow-2xl overflow-hidden text-left">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[color-mix(in_oklch,var(--danger)_80%,transparent)]" />
          <span className="h-3 w-3 rounded-full bg-[color-mix(in_oklch,var(--warning)_80%,transparent)]" />
          <span className="h-3 w-3 rounded-full bg-[color-mix(in_oklch,var(--success)_80%,transparent)]" />
          <div className="ml-2 hidden items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-0.5 font-mono text-xs text-fg-muted sm:flex">
            <Icon name="lock" size={11} className="text-primary" />
            <span>wiremap.dev/demo/shop-api/graph</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden font-mono text-xs text-fg-muted sm:inline-flex">
            branch: main
          </span>
          <StatusBadge tone="success">100% indexed</StatusBadge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-border min-h-[420px] bg-bg">
        <div className="hidden md:flex md:col-span-3 flex-col justify-between p-3.5 bg-surface/50 text-xs">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-1.5 rounded border border-border bg-muted/60 px-2 py-1 text-fg-muted">
              <Icon name="search" size={13} />
              <span className="font-mono text-[11px]">Filter files...</span>
              <span className="ml-auto font-mono text-[10px] text-fg-muted">⌘K</span>
            </div>

            <div className="flex flex-col gap-1 font-mono text-[11px]">
              <span className="text-[10px] uppercase font-semibold text-fg-muted tracking-wider">
                Project Files
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-fg-muted">▾ src/routes</span>
                <div className="flex items-center gap-1.5 rounded bg-primary/10 px-2 py-1 text-primary font-medium border-l-2 border-primary">
                  <RoleDot tone="primary" />
                  <span>auth.controller.ts</span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 text-fg-muted hover:text-fg">
                  <RoleDot tone="primary" />
                  <span>order.controller.ts</span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 text-fg-muted hover:text-fg">
                  <RoleDot tone="primary" />
                  <span>product.controller.ts</span>
                </div>
              </div>

              <div className="flex flex-col gap-0.5 pt-1">
                <span className="text-fg-muted">▾ src/services</span>
                <div className="flex items-center gap-1.5 px-2 py-1 text-fg-muted">
                  <RoleDot tone="warm" />
                  <span>auth.service.ts</span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 text-fg-muted">
                  <RoleDot tone="warm" />
                  <span>payment.service.ts</span>
                </div>
              </div>

              <div className="flex flex-col gap-0.5 pt-1">
                <span className="text-fg-muted">▾ src/storage</span>
                <div className="flex items-center gap-1.5 px-2 py-1 text-fg-muted">
                  <RoleDot tone="cool" />
                  <span>user.repo.ts</span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 text-fg-muted">
                  <RoleDot tone="cool" />
                  <span>order.repo.ts</span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-border pt-2.5 font-mono text-[10px] text-fg-muted flex items-center justify-between">
            <span>36 files</span>
            <span>71 imports</span>
            <span>0 cycles</span>
          </div>
        </div>

        <div className="col-span-1 md:col-span-5 flex flex-col p-3.5 bg-bg/95 relative overflow-hidden">
          <div className="flex items-center justify-between font-mono text-[11px] text-fg-muted border-b border-border/60 pb-2">
            <span className="flex items-center gap-1">
              <Icon name="layers" size={13} className="text-primary" />
              <span>Layered Graph</span>
            </span>
            <span>grouped by folder</span>
          </div>

          <div className="relative my-auto flex h-[340px] w-full items-center justify-center">
            <svg
              viewBox="0 0 460 270"
              className="h-full w-full select-none"
              aria-label="Interactive architecture graph"
            >
              <defs>
                <pattern id="mini-grid" width="16" height="16" patternUnits="userSpaceOnUse">
                  <circle cx="2" cy="2" r="0.75" fill="var(--border)" opacity="0.6" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#mini-grid)" />

              <g opacity="0.4">
                <rect
                  x="5"
                  y="35"
                  width="135"
                  height="180"
                  rx="6"
                  fill="color-mix(in oklch, var(--surface) 40%, transparent)"
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <text
                  x="14"
                  y="48"
                  fill="var(--fg-muted)"
                  fontSize="8"
                  fontFamily="var(--font-mono)"
                >
                  routes/
                </text>

                <rect
                  x="160"
                  y="10"
                  width="135"
                  height="235"
                  rx="6"
                  fill="color-mix(in oklch, var(--surface) 40%, transparent)"
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <text
                  x="169"
                  y="23"
                  fill="var(--fg-muted)"
                  fontSize="8"
                  fontFamily="var(--font-mono)"
                >
                  services/
                </text>

                <rect
                  x="315"
                  y="105"
                  width="135"
                  height="150"
                  rx="6"
                  fill="color-mix(in oklch, var(--surface) 40%, transparent)"
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <text
                  x="324"
                  y="118"
                  fill="var(--fg-muted)"
                  fontSize="8"
                  fontFamily="var(--font-mono)"
                >
                  storage/
                </text>
              </g>

              {graphPaths.map((d, index) => (
                <g key={d}>
                  <path d={d} stroke="var(--border)" strokeWidth="1.2" fill="none" opacity="0.7" />
                  <path
                    d={d}
                    stroke="color-mix(in oklch, var(--primary) 75%, var(--border))"
                    strokeWidth="1.4"
                    strokeDasharray="4 4"
                    fill="none"
                  >
                    <animate
                      attributeName="stroke-dashoffset"
                      from="0"
                      to="-16"
                      dur={`${1.5 + index * 0.2}s`}
                      repeatCount="indefinite"
                    />
                  </path>
                  <circle r="2.5" fill="var(--primary)">
                    <animateMotion
                      dur={`${2.0 + index * 0.3}s`}
                      repeatCount="indefinite"
                      path={d}
                    />
                  </circle>
                </g>
              ))}

              <g>
                <circle cx="15" cy="46" r="3" fill="none" stroke="var(--primary)" strokeWidth="1.2">
                  <animate
                    attributeName="r"
                    values="2.5;12;2.5"
                    dur="2.2s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.9;0;0.9"
                    dur="2.2s"
                    repeatCount="indefinite"
                  />
                </circle>
                <rect
                  x="15"
                  y="46"
                  width="115"
                  height="42"
                  rx="5"
                  fill="var(--surface)"
                  stroke="var(--primary)"
                  strokeWidth="1.5"
                />
                <rect x="23" y="55" width="5" height="5" rx="1" fill="var(--primary)" />
                <text
                  x="32"
                  y="60"
                  fill="var(--fg)"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                  fontWeight="600"
                >
                  auth.controller
                </text>
                <text
                  x="23"
                  y="77"
                  fill="var(--fg-muted)"
                  fontSize="7.5"
                  fontFamily="var(--font-mono)"
                >
                  POST /api/auth
                </text>
              </g>

              <g>
                <rect
                  x="15"
                  y="165"
                  width="115"
                  height="42"
                  rx="5"
                  fill="var(--surface)"
                  stroke="var(--border)"
                  strokeWidth="1"
                />
                <rect x="23" y="174" width="5" height="5" rx="1" fill="var(--primary)" />
                <text
                  x="32"
                  y="179"
                  fill="var(--fg)"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                  fontWeight="600"
                >
                  order.controller
                </text>
                <text
                  x="23"
                  y="196"
                  fill="var(--fg-muted)"
                  fontSize="7.5"
                  fontFamily="var(--font-mono)"
                >
                  POST /api/order
                </text>
              </g>

              <g>
                <rect
                  x="170"
                  y="15"
                  width="115"
                  height="42"
                  rx="5"
                  fill="var(--surface)"
                  stroke="var(--border)"
                  strokeWidth="1"
                />
                <rect x="178" y="24" width="5" height="5" rx="1" fill="var(--warning)" />
                <text
                  x="187"
                  y="29"
                  fill="var(--fg)"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                  fontWeight="600"
                >
                  session.guard
                </text>
                <text
                  x="178"
                  y="46"
                  fill="var(--fg-muted)"
                  fontSize="7.5"
                  fontFamily="var(--font-mono)"
                >
                  verifySession()
                </text>
              </g>

              <g>
                <rect
                  x="170"
                  y="105"
                  width="115"
                  height="42"
                  rx="5"
                  fill="var(--surface)"
                  stroke="var(--border)"
                  strokeWidth="1"
                />
                <rect
                  x="178"
                  y="114"
                  width="5"
                  height="5"
                  rx="1"
                  fill="color-mix(in oklch, var(--danger) 60%, var(--primary))"
                />
                <text
                  x="187"
                  y="119"
                  fill="var(--fg)"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                  fontWeight="600"
                >
                  auth.service
                </text>
                <text
                  x="178"
                  y="136"
                  fill="var(--fg-muted)"
                  fontSize="7.5"
                  fontFamily="var(--font-mono)"
                >
                  issueSession()
                </text>
              </g>

              <g>
                <rect
                  x="170"
                  y="185"
                  width="115"
                  height="42"
                  rx="5"
                  fill="var(--surface)"
                  stroke="var(--border)"
                  strokeWidth="1"
                />
                <rect
                  x="178"
                  y="194"
                  width="5"
                  height="5"
                  rx="1"
                  fill="color-mix(in oklch, var(--danger) 60%, var(--primary))"
                />
                <text
                  x="187"
                  y="199"
                  fill="var(--fg)"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                  fontWeight="600"
                >
                  order.service
                </text>
                <text
                  x="178"
                  y="216"
                  fill="var(--fg-muted)"
                  fontSize="7.5"
                  fontFamily="var(--font-mono)"
                >
                  chargeAndFulfill()
                </text>
              </g>

              <g>
                <rect
                  x="325"
                  y="125"
                  width="115"
                  height="42"
                  rx="5"
                  fill="var(--surface)"
                  stroke="var(--border)"
                  strokeWidth="1"
                />
                <rect
                  x="333"
                  y="134"
                  width="5"
                  height="5"
                  rx="1"
                  fill="color-mix(in oklch, var(--success) 50%, var(--primary))"
                />
                <text
                  x="342"
                  y="139"
                  fill="var(--fg)"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                  fontWeight="600"
                >
                  user.repo
                </text>
                <text
                  x="333"
                  y="156"
                  fill="var(--fg-muted)"
                  fontSize="7.5"
                  fontFamily="var(--font-mono)"
                >
                  findByEmail()
                </text>
              </g>

              <g>
                <rect
                  x="325"
                  y="215"
                  width="115"
                  height="42"
                  rx="5"
                  fill="var(--surface)"
                  stroke="var(--border)"
                  strokeWidth="1"
                />
                <rect
                  x="333"
                  y="224"
                  width="5"
                  height="5"
                  rx="1"
                  fill="color-mix(in oklch, var(--success) 50%, var(--primary))"
                />
                <text
                  x="342"
                  y="229"
                  fill="var(--fg)"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                  fontWeight="600"
                >
                  user.table
                </text>
                <text
                  x="333"
                  y="246"
                  fill="var(--fg-muted)"
                  fontSize="7.5"
                  fontFamily="var(--font-mono)"
                >
                  users (postgres)
                </text>
              </g>
            </svg>
          </div>
        </div>

        <div className="hidden md:flex md:col-span-4 flex-col gap-3 p-3.5 bg-surface/50 text-xs">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="font-mono text-xs font-semibold text-fg">auth.controller.ts</span>
            <StatusBadge tone="accent">controller</StatusBadge>
          </div>

          <div className="flex flex-col gap-1.5 font-mono text-[11px]">
            <span className="text-[10px] uppercase font-semibold text-fg-muted tracking-wider">
              Exposed Routes
            </span>
            <div className="flex flex-col gap-1 rounded border border-border bg-muted/30 p-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-primary">POST /api/auth/sign-in</span>
                <span className="text-[10px] text-fg-muted">line 24</span>
              </div>
              <span className="text-[10px] text-fg-muted">guard: session.guard.ts</span>
            </div>
            <div className="flex flex-col gap-1 rounded border border-border bg-muted/30 p-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-primary">POST /api/auth/sign-up</span>
                <span className="text-[10px] text-fg-muted">line 56</span>
              </div>
              <span className="text-[10px] text-fg-muted">public route</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 font-mono text-[11px]">
            <span className="text-[10px] uppercase font-semibold text-fg-muted tracking-wider">
              Imports (3)
            </span>
            <div className="flex flex-col gap-1 text-[11px] text-fg-muted">
              <span>→ auth.service.ts</span>
              <span>→ session.guard.ts</span>
              <span>→ user.repo.ts</span>
            </div>
          </div>

          <div className="mt-auto rounded border border-border bg-surface p-2.5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-fg-muted">Architecture Safety</span>
              <StatusBadge tone="success">verified safe</StatusBadge>
            </div>
            <span className="font-mono text-[11px] text-fg pt-1 block">
              0 cycles · 0 unguarded leaks
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Home() {
  const { t } = useMessages("nav");
  const { t: common } = useMessages("common");

  return (
    <div className="relative min-h-dvh w-full bg-bg overflow-hidden">
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full opacity-40 select-none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <pattern id="home-bg-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path
              d="M 28 0 L 0 0 0 28"
              fill="none"
              stroke="var(--border)"
              strokeWidth="0.75"
              strokeDasharray="2 3"
            />
            <circle cx="0" cy="0" r="1.25" fill="var(--border)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#home-bg-grid)" />
      </svg>

      <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-16 px-4 py-8 sm:py-14">
        <header className="relative flex items-center justify-between rounded-xl border border-border bg-surface/70 px-5 py-3.5 backdrop-blur-md overflow-hidden">
          <div className="relative z-10 flex items-center gap-3">
            <Link
              to="/"
              className="group flex items-center gap-2.5 font-mono text-base font-semibold text-fg no-underline"
            >
              <span className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-primary shadow-xs transition-colors group-hover:border-primary">
                <Icon name="graph" size={18} />
                <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
              </span>
              <span>{common("brand.name")}</span>
            </Link>
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono text-[10px] text-fg-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              AST engine live
            </span>
          </div>

          <nav className="relative z-10 flex items-center gap-2 [&_a]:no-underline">
            <Link to="/sign-in" className={buttonClassName("ghost")}>
              {t("nav.home.goToSignIn")}
            </Link>
            <Link to="/sign-up" className={buttonClassName("primary")}>
              {t("nav.landing.start")}
            </Link>
          </nav>
        </header>

        <section className="relative flex flex-col items-center gap-8 text-center sm:py-4">
          <div className="pointer-events-none absolute -top-2 left-4 hidden xl:flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-1.5 shadow-md">
            <Icon name="graph" size={16} className="text-primary" />
            <span className="font-mono text-xs text-fg">dependency graph</span>
          </div>
          <div className="pointer-events-none absolute -top-2 right-4 hidden xl:flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-1.5 shadow-md">
            <Icon name="route" size={16} className="text-primary" />
            <span className="font-mono text-xs text-fg">HTTP routes</span>
          </div>
          <div className="pointer-events-none absolute top-32 -left-6 hidden 2xl:flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-1.5 shadow-md">
            <Icon name="shield" size={16} className="text-primary" />
            <span className="font-mono text-xs text-fg">auth guards</span>
          </div>
          <div className="pointer-events-none absolute top-32 -right-6 hidden 2xl:flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-1.5 shadow-md">
            <Icon name="sparkle" size={16} className="text-primary" />
            <span className="font-mono text-xs text-fg">AI graph grounded</span>
          </div>

          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 font-mono text-xs text-fg-muted shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            <span>Repository architecture &amp; graph intelligence</span>
          </div>

          <div className="flex max-w-3xl flex-col gap-4">
            <h1 className="m-0 text-4xl font-semibold tracking-tight text-fg sm:text-5xl lg:text-6xl">
              {t("nav.landing.title")}
            </h1>
            <p className="mx-auto m-0 max-w-2xl text-base leading-relaxed text-fg-muted sm:text-lg">
              {t("nav.landing.lead")}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link to="/sign-up" className={buttonClassName("primary")}>
              {t("nav.landing.start")}
            </Link>
            <Link to="/sign-in" className={buttonClassName("secondary")}>
              {t("nav.home.goToSignIn")}
            </Link>
          </div>

          <div className="w-full pt-4">
            <ProductShowcase />
          </div>
        </section>

        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-1 text-center sm:text-left">
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">
              Capabilities
            </span>
            <h2 className="m-0 text-2xl font-semibold tracking-tight text-fg">
              Everything about your system in one interactive graph
            </h2>
          </div>
          <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
            {POINTS.map((point) => (
              <li
                key={point.key}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-6 shadow-sm transition-colors hover:border-[color-mix(in_oklch,var(--border)_75%,var(--fg))]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted text-primary">
                    <Icon name={point.icon} size={20} />
                  </div>
                  <span className="font-mono text-xs text-fg-muted">{point.tag}</span>
                </div>
                <h3 className="m-0 text-base font-semibold text-fg">
                  {t(`nav.landing.${point.key}.title` as Parameters<typeof t>[0])}
                </h3>
                <p className="m-0 text-sm leading-relaxed text-fg-muted">
                  {t(`nav.landing.${point.key}.body` as Parameters<typeof t>[0])}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <footer className="flex flex-col items-center justify-between gap-4 border-t border-border pt-8 pb-10 text-xs text-fg-muted sm:flex-row sm:text-sm">
          <div className="flex items-center gap-2">
            <Icon name="graph" size={16} className="text-primary" />
            <span>{common("brand.name")} — See how your code is wired.</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/privacy" className="text-fg-muted no-underline hover:text-fg">
              {t("nav.privacy.link")}
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
