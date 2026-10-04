import { Link } from "@tanstack/react-router";
import { Icon, type ReactNode, StatusBadge, useMessages } from "~/import.js";

export interface AuthFrameProps {
  readonly title?: string;
  readonly subtitle?: string;
  readonly badge?: string;
  readonly children: ReactNode;
}

// Clean graph background pattern matching the dark grid layout.
function GraphBgPattern({ id = "auth-bg" }: { readonly id?: string }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-40 select-none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <pattern id={`${id}-grid`} width="28" height="28" patternUnits="userSpaceOnUse">
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
      <rect width="100%" height="100%" fill={`url(#${id}-grid)`} />
    </svg>
  );
}

// An example graph of a backend repository, animated to show imports and route connectivity.
function ExampleGraph() {
  const paths = [
    "M 170 98 C 187 98, 187 48, 205 48",
    "M 170 98 C 187 98, 187 178, 205 178",
    "M 170 288 C 195 288, 180 48, 205 48",
    "M 170 288 C 187 288, 187 308, 205 308",
    "M 355 178 C 372 178, 372 203, 390 203",
    "M 355 308 C 372 308, 372 203, 390 203",
    "M 465 231 C 465 270, 465 270, 465 310",
  ];

  return (
    <div className="relative flex flex-col items-center justify-center gap-3 w-full max-w-[560px]">
      <svg
        viewBox="0 0 560 380"
        className="h-full w-full select-none"
        aria-label="Example dependency graph"
      >
        <defs>
          <pattern id="graph-dots" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1" fill="var(--border)" opacity="0.6" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#graph-dots)" rx="8" />

        <g opacity="0.5">
          <rect
            x="10"
            y="55"
            width="170"
            height="275"
            rx="8"
            fill="color-mix(in oklch, var(--surface) 40%, transparent)"
            stroke="var(--border)"
            strokeDasharray="3 3"
          />
          <text x="22" y="72" fill="var(--fg-muted)" fontSize="9" fontFamily="var(--font-mono)">
            routes/
          </text>

          <rect
            x="195"
            y="10"
            width="170"
            height="340"
            rx="8"
            fill="color-mix(in oklch, var(--surface) 40%, transparent)"
            stroke="var(--border)"
            strokeDasharray="3 3"
          />
          <text x="207" y="27" fill="var(--fg-muted)" fontSize="9" fontFamily="var(--font-mono)">
            domain/
          </text>

          <rect
            x="380"
            y="150"
            width="170"
            height="225"
            rx="8"
            fill="color-mix(in oklch, var(--surface) 40%, transparent)"
            stroke="var(--border)"
            strokeDasharray="3 3"
          />
          <text x="392" y="167" fill="var(--fg-muted)" fontSize="9" fontFamily="var(--font-mono)">
            storage/
          </text>
        </g>

        {paths.map((d, index) => (
          <g key={d}>
            <path d={d} stroke="var(--border)" strokeWidth="1.5" fill="none" opacity="0.7" />
            <path
              d={d}
              stroke="color-mix(in oklch, var(--primary) 70%, var(--border))"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              fill="none"
            >
              <animate
                attributeName="stroke-dashoffset"
                from="0"
                to="-16"
                dur={`${1.6 + index * 0.2}s`}
                repeatCount="indefinite"
              />
            </path>
            <circle r="2.5" fill="var(--primary)">
              <animateMotion dur={`${2.2 + index * 0.3}s`} repeatCount="indefinite" path={d} />
            </circle>
          </g>
        ))}

        <g>
          <circle cx="20" cy="70" r="3" fill="none" stroke="var(--primary)" strokeWidth="1.5">
            <animate attributeName="r" values="3;16;3" dur="2.4s" repeatCount="indefinite" />
            <animate
              attributeName="opacity"
              values="0.9;0;0.9"
              dur="2.4s"
              repeatCount="indefinite"
            />
          </circle>
          <rect
            x="20"
            y="70"
            width="150"
            height="56"
            rx="6"
            fill="var(--surface)"
            stroke="var(--border)"
            strokeWidth="1"
          />
          <rect x="32" y="82" width="6" height="6" rx="1.5" fill="var(--primary)" />
          <text
            x="44"
            y="88"
            fill="var(--fg)"
            fontSize="11"
            fontFamily="var(--font-mono)"
            fontWeight="600"
          >
            auth.route.ts
          </text>
          <rect
            x="32"
            y="99"
            width="30"
            height="15"
            rx="3"
            fill="color-mix(in oklch, var(--primary) 15%, var(--surface))"
          />
          <text
            x="47"
            y="110"
            textAnchor="middle"
            fill="var(--primary)"
            fontSize="8.5"
            fontFamily="var(--font-mono)"
            fontWeight="700"
          >
            POST
          </text>
          <text x="68" y="110" fill="var(--fg-muted)" fontSize="9" fontFamily="var(--font-mono)">
            /api/auth
          </text>
        </g>

        <g>
          <rect
            x="20"
            y="260"
            width="150"
            height="56"
            rx="6"
            fill="var(--surface)"
            stroke="var(--border)"
            strokeWidth="1"
          />
          <rect x="32" y="272" width="6" height="6" rx="1.5" fill="var(--primary)" />
          <text
            x="44"
            y="278"
            fill="var(--fg)"
            fontSize="11"
            fontFamily="var(--font-mono)"
            fontWeight="600"
          >
            checkout.route.ts
          </text>
          <rect
            x="32"
            y="289"
            width="30"
            height="15"
            rx="3"
            fill="color-mix(in oklch, var(--primary) 15%, var(--surface))"
          />
          <text
            x="47"
            y="300"
            textAnchor="middle"
            fill="var(--primary)"
            fontSize="8.5"
            fontFamily="var(--font-mono)"
            fontWeight="700"
          >
            POST
          </text>
          <text x="68" y="300" fill="var(--fg-muted)" fontSize="9" fontFamily="var(--font-mono)">
            /api/checkout
          </text>
        </g>

        <g>
          <rect
            x="205"
            y="20"
            width="150"
            height="56"
            rx="6"
            fill="var(--surface)"
            stroke="var(--border)"
            strokeWidth="1"
          />
          <rect x="217" y="32" width="6" height="6" rx="1.5" fill="var(--warning)" />
          <text
            x="229"
            y="38"
            fill="var(--fg)"
            fontSize="11"
            fontFamily="var(--font-mono)"
            fontWeight="600"
          >
            session.guard.ts
          </text>
          <text x="217" y="62" fill="var(--fg-muted)" fontSize="9.5" fontFamily="var(--font-mono)">
            verifySession()
          </text>
        </g>

        <g>
          <rect
            x="205"
            y="150"
            width="150"
            height="56"
            rx="6"
            fill="var(--surface)"
            stroke="var(--border)"
            strokeWidth="1"
          />
          <rect
            x="217"
            y="162"
            width="6"
            height="6"
            rx="1.5"
            fill="color-mix(in oklch, var(--danger) 60%, var(--primary))"
          />
          <text
            x="229"
            y="168"
            fill="var(--fg)"
            fontSize="11"
            fontFamily="var(--font-mono)"
            fontWeight="600"
          >
            auth.service.ts
          </text>
          <text x="217" y="192" fill="var(--fg-muted)" fontSize="9.5" fontFamily="var(--font-mono)">
            issueSession()
          </text>
        </g>

        <g>
          <rect
            x="205"
            y="280"
            width="150"
            height="56"
            rx="6"
            fill="var(--surface)"
            stroke="var(--border)"
            strokeWidth="1"
          />
          <rect
            x="217"
            y="292"
            width="6"
            height="6"
            rx="1.5"
            fill="color-mix(in oklch, var(--danger) 60%, var(--primary))"
          />
          <text
            x="229"
            y="298"
            fill="var(--fg)"
            fontSize="11"
            fontFamily="var(--font-mono)"
            fontWeight="600"
          >
            order.service.ts
          </text>
          <text x="217" y="322" fill="var(--fg-muted)" fontSize="9.5" fontFamily="var(--font-mono)">
            fulfillOrder()
          </text>
        </g>

        <g>
          <rect
            x="390"
            y="175"
            width="150"
            height="56"
            rx="6"
            fill="var(--surface)"
            stroke="var(--border)"
            strokeWidth="1"
          />
          <rect
            x="402"
            y="187"
            width="6"
            height="6"
            rx="1.5"
            fill="color-mix(in oklch, var(--success) 50%, var(--primary))"
          />
          <text
            x="414"
            y="193"
            fill="var(--fg)"
            fontSize="11"
            fontFamily="var(--font-mono)"
            fontWeight="600"
          >
            user.repo.ts
          </text>
          <text x="402" y="217" fill="var(--fg-muted)" fontSize="9.5" fontFamily="var(--font-mono)">
            findUserByEmail()
          </text>
        </g>

        <g>
          <rect
            x="390"
            y="310"
            width="150"
            height="56"
            rx="6"
            fill="var(--surface)"
            stroke="var(--border)"
            strokeWidth="1"
          />
          <rect
            x="402"
            y="322"
            width="6"
            height="6"
            rx="1.5"
            fill="color-mix(in oklch, var(--success) 50%, var(--primary))"
          />
          <text
            x="414"
            y="328"
            fill="var(--fg)"
            fontSize="11"
            fontFamily="var(--font-mono)"
            fontWeight="600"
          >
            user.table.ts
          </text>
          <text x="402" y="352" fill="var(--fg-muted)" fontSize="9.5" fontFamily="var(--font-mono)">
            users (postgres)
          </text>
        </g>
      </svg>
      <div className="flex items-center justify-center gap-4 font-mono text-[11px] text-fg-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-xs bg-primary" /> route
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-xs bg-warning" /> guard
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-xs bg-[color-mix(in_oklch,var(--danger)_60%,var(--primary))]" />{" "}
          service
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-xs bg-[color-mix(in_oklch,var(--success)_50%,var(--primary))]" />{" "}
          store
        </span>
      </div>
    </div>
  );
}

// Two-column layout with graph background pattern and improved auth form card.
export function AuthFrame({ title, subtitle, badge, children }: AuthFrameProps) {
  const { t } = useMessages("common");

  return (
    <main className="relative grid min-h-dvh w-full lg:grid-cols-2 bg-bg overflow-hidden">
      <GraphBgPattern id="page-bg" />

      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-muted/20 p-8 lg:flex xl:p-12">
        <div className="relative z-10 flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2 font-mono text-xs text-fg">
            <Icon name="branch" size={14} className="text-primary" />
            <span className="font-semibold">shop-api</span>
            <span className="text-fg-muted">· main</span>
          </div>
          <StatusBadge tone="accent">live graph</StatusBadge>
        </div>

        <div className="relative z-10 my-auto py-6">
          <ExampleGraph />
        </div>

        <div className="relative z-10 flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-center justify-between font-mono text-xs">
            <span className="font-semibold text-fg">Architecture summary</span>
            <span className="text-fg-muted">scan #142 · 0 cycles</span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center font-mono">
            <div className="flex flex-col rounded-md border border-border bg-muted/60 p-2">
              <span className="text-base font-semibold text-fg">36</span>
              <span className="text-[11px] text-fg-muted">files</span>
            </div>
            <div className="flex flex-col rounded-md border border-border bg-muted/60 p-2">
              <span className="text-base font-semibold text-fg">71</span>
              <span className="text-[11px] text-fg-muted">imports</span>
            </div>
            <div className="flex flex-col rounded-md border border-border bg-muted/60 p-2">
              <span className="text-base font-semibold text-fg">21</span>
              <span className="text-[11px] text-fg-muted">routes</span>
            </div>
            <div className="flex flex-col rounded-md border border-border bg-muted/60 p-2">
              <span className="text-base font-semibold text-fg">0</span>
              <span className="text-[11px] text-fg-muted">cycles</span>
            </div>
          </div>
          <p className="m-0 text-xs leading-relaxed text-fg-muted">
            Explore import graphs, file roles, and route connectivity before you merge.
          </p>
        </div>
      </section>

      <section className="relative flex flex-col justify-center px-4 py-10 sm:px-8 sm:py-16">
        <div className="relative z-10 mx-auto flex w-full max-w-sm flex-col gap-6">
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
            <span className="tracking-tight">{t("brand.name")}</span>
          </Link>

          <div className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-2xl p-6 sm:p-7 flex flex-col gap-5">
            <div className="flex flex-col gap-1.5 pb-2 border-b border-border/60">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono text-[10px] text-fg-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {badge ?? "SECURE ACCESS"}
                </span>
                <span className="font-mono text-[10px] text-fg-muted">v0.1</span>
              </div>
              <h1 className="m-0 font-mono text-xl font-semibold tracking-tight text-fg">
                {title ?? "Authentication"}
              </h1>
              <p className="m-0 text-xs text-fg-muted leading-relaxed">
                {subtitle ?? "Inspect your repository dependency graph securely."}
              </p>
            </div>

            <div className="ui-auth-frame flex flex-col gap-4 [&_nav]:flex [&_nav]:justify-between [&_nav]:gap-2 [&_nav]:text-xs [&_nav]:font-mono [&_a]:text-xs [&_a]:font-mono [&_a]:text-fg-muted [&_a:hover]:text-primary [&_a]:no-underline [&_a:hover]:no-underline [&_button]:no-underline [&_.ui-button]:no-underline">
              {children}
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 font-mono text-[11px] text-fg-muted">
            <Icon name="shield" size={13} className="text-primary" />
            <span>Read-only AST · Zero code retention</span>
          </div>
        </div>
      </section>
    </main>
  );
}
