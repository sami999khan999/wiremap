import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  type BadgeTone,
  Button,
  type ButtonVariant,
  Callout,
  type CalloutTone,
  CodeList,
  type CSSProperties,
  DataTable,
  EmptyState,
  Field,
  type FontKey,
  FontRegistry,
  Icon,
  Input,
  type ModePreference,
  Popover,
  QrCode,
  type ReactNode,
  StatusBadge,
  type ThemeKey,
  ThemeRegistry,
  useState,
  Zone,
} from "~/import.js";

// The one surface that renders every theme against every primitive, so an unreadable
// pairing is looked at directly rather than found in production.
export const Route = createFileRoute("/(dev)/kitchen-sink")({
  // `(dev)` groups files and contributes nothing to the URL — it is not a build
  // condition, so without this the page is a public route in production.
  loader: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: KitchenSink,
});

// The twelve names every theme declares. A theme that omits one shows up here as a
// swatch of whatever leaked through.
const TOKENS = [
  "bg",
  "surface",
  "muted",
  "border",
  "fg",
  "fg-muted",
  "primary",
  "primary-fg",
  "success",
  "warning",
  "danger",
  "ring",
] as const;

const VARIANTS: readonly ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];
const TONES: readonly BadgeTone[] = ["neutral", "accent", "success", "warning", "danger"];
const CALLOUTS: readonly CalloutTone[] = ["info", "success", "warning", "danger"];

// Shaped like real backup codes, because the grid's column count is what is being
// looked at and five short strings would not show it.
const CODES: readonly string[] = [
  "4f2a-91cd",
  "7b18-30ea",
  "c0d4-6f77",
  "19ae-b2c5",
  "83f1-4d6b",
  "e57c-08a9",
];

// A real `otpauth://` URI: `QrCode` re-encodes nothing, so a trimmed sample would
// render a QR that scans into an authenticator generating the wrong codes.
const OTPAUTH =
  "otpauth://totp/Loadbearing:you@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Loadbearing";
const PREFERENCES: readonly ModePreference[] = ["light", "dark", "system"];

interface SampleRow {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

const ROWS: readonly SampleRow[] = [
  { id: "1", name: "Alpha", count: 12 },
  { id: "2", name: "Beta", count: 48 },
  { id: "3", name: "Gamma", count: 7 },
];

// Layout only: every colour comes from class.css or a token read by name, so nothing
// here can make a broken theme look fine.
const page: CSSProperties = {
  maxWidth: "72rem",
  margin: "0 auto",
  padding: "var(--space-8) var(--space-6)",
};

const card: CSSProperties = {
  background: "var(--surface)",
  border: "var(--border-width) solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: "var(--space-6)",
  marginBottom: "var(--space-6)",
};

const row: CSSProperties = { display: "flex", flexWrap: "wrap", gap: "var(--space-2)" };
const gap: CSSProperties = { height: "var(--space-4)" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={card}>
      <h2
        style={{
          fontSize: "var(--text-lg)",
          fontWeight: "var(--weight-semibold)",
          margin: "0 0 var(--space-4)",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Swatch({ name }: { name: string }) {
  return (
    <div style={{ minWidth: "7rem" }}>
      <div
        style={{
          background: `var(--${name})`,
          border: "var(--border-width) solid var(--border)",
          borderRadius: "var(--radius-sm)",
          height: "2.75rem",
        }}
      />
      <code
        style={{
          color: "var(--fg-muted)",
          display: "block",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-xs)",
          marginTop: "var(--space-1)",
        }}
      >
        {`--${name}`}
      </code>
    </div>
  );
}

function Pair({ fg, bg, label }: { fg: string; bg: string; label: string }) {
  return (
    <div
      style={{
        background: `var(--${bg})`,
        border: "var(--border-width) solid var(--border)",
        borderRadius: "var(--radius-md)",
        color: `var(--${fg})`,
        fontSize: "var(--text-sm)",
        padding: "var(--space-3) var(--space-4)",
      }}
    >
      {label}
    </div>
  );
}

function KitchenSink() {
  const { appearance, appearanceSnapshot } = Route.useRouteContext();
  // State, not the route context: the context is fixed at load, so a mode click built on it
  // put the loaded theme back.
  const [current, setCurrent] = useState(appearanceSnapshot);
  const { theme, mode, preference, font } = current;

  const choose = (next: ThemeKey, wanted: ModePreference, face: FontKey = font): void => {
    const prefersDark =
      typeof matchMedia === "function" && matchMedia("(prefers-color-scheme:dark)").matches;
    appearance.choose(next, wanted, prefersDark, face);
    setCurrent(appearance.current);
  };

  return (
    <main style={page}>
      <h1 style={{ fontSize: "var(--text-2xl)", marginTop: 0 }}>Kitchen sink</h1>

      <Section title="Appearance">
        <div style={row}>
          {ThemeRegistry.all().map((key) => (
            <Button
              key={key}
              variant={key === theme ? "primary" : "secondary"}
              onClick={() => choose(key, preference)}
            >
              {`${ThemeRegistry.meta(key).label} (${ThemeRegistry.meta(key).modes.join("/")})`}
            </Button>
          ))}
        </div>
        <div style={gap} />
        <div style={row}>
          {PREFERENCES.map((key) => (
            <Button
              key={key}
              variant={key === preference ? "primary" : "secondary"}
              onClick={() => choose(theme, key)}
            >
              {key}
            </Button>
          ))}
        </div>
        <div style={gap} />
        <div style={row}>
          {FontRegistry.all().map((key) => (
            <Button
              key={key}
              variant={key === font ? "primary" : "secondary"}
              onClick={() => choose(theme, preference, key)}
            >
              {FontRegistry.meta(key).label}
            </Button>
          ))}
        </div>
        <p style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)" }}>
          {`rendering ${theme} / ${mode} / ${font}, preference ${preference}`}
        </p>
      </Section>

      <Section title="Tokens">
        <div style={row}>
          {TOKENS.map((name) => (
            <Swatch key={name} name={name} />
          ))}
        </div>
      </Section>

      <Section title="Contrast pairs">
        <div style={row}>
          <Pair fg="fg" bg="bg" label="fg on bg" />
          <Pair fg="fg-muted" bg="muted" label="fg-muted on muted" />
          <Pair fg="primary-fg" bg="primary" label="primary-fg on primary" />
          <Pair fg="primary-fg" bg="danger" label="primary-fg on danger" />
          <Pair fg="danger" bg="bg" label="danger on bg" />
        </div>
      </Section>

      <Section title="Primitives">
        <div style={row}>
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
          <Button disabled>disabled</Button>
        </div>
        <div style={gap} />
        <div style={row}>
          {TONES.map((tone) => (
            <StatusBadge key={tone} tone={tone}>
              {tone}
            </StatusBadge>
          ))}
        </div>
        <div style={gap} />
        <div style={row}>
          <Icon name="check" label="check" />
          <Icon name="user" label="user" />
          <Icon name="chevron-down" label="chevron down" />
        </div>
        <div style={gap} />
        <div style={{ display: "grid", gap: "var(--space-4)", maxWidth: "24rem" }}>
          <Field label="Email" htmlFor="ks-email" hint="A hint sits under the control.">
            <Input id="ks-email" placeholder="you@example.com" />
          </Field>
          <Field
            label="Broken"
            htmlFor="ks-broken"
            error="An error adds a line, never replaces one."
          >
            <Input id="ks-broken" defaultValue="not an address" />
          </Field>
        </div>
      </Section>

      <Section title="Blocks">
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          {CALLOUTS.map((tone) => (
            <Callout key={tone} tone={tone} title={tone}>
              A callout carries one message and a tone, never a colour prop.
            </Callout>
          ))}
        </div>
        <div style={gap} />
        <div style={{ display: "grid", gap: "var(--space-4)", maxWidth: "24rem" }}>
          <CodeList values={CODES} label="Sample backup codes" />
          <QrCode value={OTPAUTH} label="Sample authenticator QR" />
        </div>
        <div style={gap} />
        {
          // Open it to see the panel against the theme. It is the one component here whose
          // appearance is behind a click, which is why it sits at the end of a section.
        }
        <Popover label="A sample popover" trigger={<Icon name="bell" />} align="start">
          <p style={{ margin: 0 }}>A panel anchored to the control that opened it.</p>
        </Popover>
      </Section>

      <Section title="Composites">
        <DataTable
          caption="A table with three rows"
          columns={[
            { key: "name", header: "Name", cell: (r: SampleRow) => r.name },
            { key: "count", header: "Count", cell: (r: SampleRow) => r.count, align: "end" },
          ]}
          rows={ROWS}
        />
        <div style={gap} />
        <DataTable.Skeleton rows={3} columns={2} />
        <div style={gap} />
        <EmptyState
          icon="check"
          title="Nothing here yet"
          description="An empty state is an invitation to act."
          action={<Button>Do the thing</Button>}
        />
      </Section>

      <Section title="Zone">
        <Zone
          label="A sample zone"
          items={[
            {
              key: "count",
              title: "A count",
              content: <p style={{ margin: 0, fontSize: "var(--text-2xl)" }}>42</p>,
            },
            {
              key: "status",
              title: "With an action",
              content: <StatusBadge tone="success">Healthy</StatusBadge>,
              action: <Button variant="ghost">Hide</Button>,
            },
            {
              key: "text",
              title: "A longer unit",
              content: (
                <p style={{ margin: 0, color: "var(--fg-muted)" }}>
                  Units sit side by side, as many to a row as fit, and stack on a phone.
                </p>
              ),
            },
          ]}
        />
        <div style={gap} />
        <Zone
          label="An empty zone"
          items={[]}
          empty={<EmptyState title="Nothing in this zone" description="Every unit was hidden." />}
        />
      </Section>
    </main>
  );
}
