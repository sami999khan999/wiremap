import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  AlertDialog,
  type BadgeTone,
  Button,
  type ButtonVariant,
  Callout,
  type CalloutTone,
  CodeList,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  type FontKey,
  FontRegistry,
  Icon,
  Input,
  Menu,
  type ModePreference,
  Popover,
  Prose,
  QrCode,
  type ReactNode,
  Select,
  StatusBadge,
  Textarea,
  type ThemeKey,
  ThemeRegistry,
  ThemeToggle,
  Tooltip,
  useState,
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

// What `UnifiedMarkdownRenderer` writes for each block, so every theme shows them. Re-render
// it when the markup changes: packages/infrastructure/docs/reference/doc-renderer.md.
const DOC_BLOCKS =
  '<div class="ui-callout ui-callout--success">\n<div class="ui-callout__body">\n<p>Every block below is written in Markdown and rendered once, at publish.</p>\n</div>\n</div>\n<div class="ui-card-grid"><a class="ui-card" data-icon="rocket" href="/docs"><span class="ui-card__title">Install</span><span class="ui-card__description">Add the packages and start the stack.</span></a><a class="ui-card" data-icon="book" href="/docs"><span class="ui-card__title">Reference</span><span class="ui-card__description">Every port, contract and rule.</span></a></div>\n<div class="ui-tabs"><div class="ui-tabs__panel"><p class="ui-tabs__title">pnpm</p><pre><code class="hljs language-sh">pnpm add @loadbearing/ui\n</code></pre></div><div class="ui-tabs__panel"><p class="ui-tabs__title">npm</p><pre><code class="hljs language-sh">npm install @loadbearing/ui\n</code></pre></div></div>\n<div class="ui-steps"><h3 id="clone-the-kit">Clone the kit</h3><p>Copy the repository.</p><h3 id="start-the-stack">Start the stack</h3><p>Run <code>pnpm infra:up</code>, then <code>pnpm dev</code>.</p></div>\n<details class="ui-accordion"><summary class="ui-accordion__summary">Why is the HTML stored?</summary><p>A page is read far more than it is written, so it is rendered once.</p></details>';

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

const SAMPLE_OPTIONS = [
  { value: "one", label: "One", description: "The first" },
  { value: "two", label: "Two" },
  { value: "three", label: "Three" },
];

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

// Layout only: every colour is one of the twelve through a utility or a variable read by
// name, so nothing here can make a broken theme look fine.
const ROW = "flex flex-wrap gap-2";
const GAP = "h-4";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-border bg-surface p-6">
      <h2 className="m-0 mb-4 font-semibold text-lg">{title}</h2>
      {children}
    </section>
  );
}

// The colour is a variable picked by name at runtime, which no utility can be generated
// for, so it is the one inline style left.
function Swatch({ name }: { name: string }) {
  return (
    <div className="min-w-28">
      <div
        className="h-11 rounded-sm border border-border"
        style={{ background: `var(--${name})` }}
      />
      <code className="mt-1 block font-mono text-fg-muted text-xs">{`--${name}`}</code>
    </div>
  );
}

function Pair({ fg, bg, label }: { fg: string; bg: string; label: string }) {
  return (
    <div
      className="rounded-md border border-border px-4 py-3 text-sm"
      style={{ background: `var(--${bg})`, color: `var(--${fg})` }}
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
  const [menuValue, setMenuValue] = useState("one");
  const [dialog, setDialog] = useState(false);
  const [alert, setAlert] = useState(false);

  const choose = (next: ThemeKey, wanted: ModePreference, face: FontKey = font): void => {
    const prefersDark =
      typeof matchMedia === "function" && matchMedia("(prefers-color-scheme:dark)").matches;
    appearance.choose(next, wanted, prefersDark, face);
    setCurrent(appearance.current);
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="mt-0 text-2xl">Kitchen sink</h1>

      <Section title="Appearance">
        <div className={ROW}>
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
        <div className={GAP} />
        <div className={ROW}>
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
        <div className={GAP} />
        <div className={ROW}>
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
        <p className="text-fg-muted text-sm">
          {`rendering ${theme} / ${mode} / ${font}, preference ${preference}`}
        </p>
      </Section>

      <Section title="Tokens">
        <div className={ROW}>
          {TOKENS.map((name) => (
            <Swatch key={name} name={name} />
          ))}
        </div>
      </Section>

      <Section title="Contrast pairs">
        <div className={ROW}>
          <Pair fg="fg" bg="bg" label="fg on bg" />
          <Pair fg="fg-muted" bg="muted" label="fg-muted on muted" />
          <Pair fg="primary-fg" bg="primary" label="primary-fg on primary" />
          <Pair fg="primary-fg" bg="danger" label="primary-fg on danger" />
          <Pair fg="danger" bg="bg" label="danger on bg" />
        </div>
      </Section>

      <Section title="Primitives">
        <div className={ROW}>
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
          <Button disabled>disabled</Button>
        </div>
        <div className={GAP} />
        <div className={ROW}>
          {TONES.map((tone) => (
            <StatusBadge key={tone} tone={tone}>
              {tone}
            </StatusBadge>
          ))}
        </div>
        <div className={GAP} />
        <div className={ROW}>
          <Icon name="check" label="check" />
          <Icon name="user" label="user" />
          <Icon name="chevron-down" label="chevron down" />
        </div>
        <div className={GAP} />
        <div className="grid max-w-sm gap-4">
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
        <div className="grid gap-3">
          {CALLOUTS.map((tone) => (
            <Callout key={tone} tone={tone} title={tone}>
              A callout carries one message and a tone, never a colour prop.
            </Callout>
          ))}
        </div>
        <div className={GAP} />
        <div className="grid max-w-sm gap-4">
          <CodeList values={CODES} label="Sample backup codes" />
          <QrCode value={OTPAUTH} label="Sample authenticator QR" />
        </div>
        <div className={GAP} />
        {
          // Open it to see the panel against the theme. It is the one component here whose
          // appearance is behind a click, which is why it sits at the end of a section.
        }
        <Popover label="A sample popover" trigger={<Icon name="bell" />} align="start">
          <p className="m-0">A panel anchored to the control that opened it.</p>
        </Popover>
      </Section>

      <Section title="Doc blocks">
        <div className="max-w-2xl">
          <Prose html={DOC_BLOCKS} copyLabel="Copy" copiedLabel="Copied" />
        </div>
      </Section>

      <Section title="Base UI">
        <div className="grid max-w-sm gap-4">
          <Field label="Select" htmlFor="ks-select" hint="A listbox that takes the theme.">
            <Select id="ks-select" label="Select" defaultValue="two" options={SAMPLE_OPTIONS} />
          </Field>
          <Field label="Notes" htmlFor="ks-notes">
            <Textarea id="ks-notes" rows={3} placeholder="Several lines" />
          </Field>
          <Menu
            label="Menu"
            value={menuValue}
            onSelect={setMenuValue}
            options={SAMPLE_OPTIONS.map((option) => ({ ...option, icon: "file" as const }))}
          />
          <ThemeToggle
            label="Mode"
            mode={mode}
            onModeChange={(next) => choose(theme, next)}
            lightLabel="Light"
            darkLabel="Dark"
          />
        </div>
        <div className={GAP} />
        <div className={ROW}>
          <Button variant="secondary" onClick={() => setDialog(true)}>
            Open a dialog
          </Button>
          <Button variant="danger" onClick={() => setAlert(true)}>
            Ask before deleting
          </Button>
          <Tooltip label="A hint on hover and focus">
            <Button variant="ghost">Hover me</Button>
          </Tooltip>
        </div>
        <Dialog
          open={dialog}
          onOpenChange={setDialog}
          title="A dialog"
          description="Focus is trapped here until it closes."
          actions={<Button onClick={() => setDialog(false)}>Done</Button>}
        />
        <AlertDialog
          open={alert}
          onOpenChange={setAlert}
          title="Delete this?"
          description="Focus starts on Cancel."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          onConfirm={() => {}}
        />
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
        <div className={GAP} />
        <DataTable.Skeleton rows={3} columns={2} />
        <div className={GAP} />
        <EmptyState
          icon="check"
          title="Nothing here yet"
          description="An empty state is an invitation to act."
          action={<Button>Do the thing</Button>}
        />
      </Section>
    </main>
  );
}
