// The rule a review cannot hold: with a dozen themes nobody checks every pairing by
// eye, and the failure is a theme somebody cannot read. A grep rather than a lint rule,
// for the same reason the assertions in check-architecture.mjs are -- it is independent
// of any config and cannot be silenced by an inline comment.
//
// Two things are checked, and the second only exists because the colours are OKLCH:
// contrast, and whether the colour is inside the sRGB gamut at all. A chroma the display
// cannot reach is silently clipped by the browser, so the shipped colour is not the one
// in the file and the contrast computed from the file is not the contrast on screen.

// @ts-check

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COLOR_DIR = join(ROOT, "packages", "ui", "src", "theme", "color");

// WCAG AA for body text, and 3:1 for the focus ring, which is a UI component boundary
// rather than text. Deliberately not applied to --border: a subtle separator at 3:1 is a
// rule no considered neutral meets, so checking it would only teach people to suppress
// this script.
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

// The twelve `packages/ui` declares. Checked for *presence* separately from contrast,
// because `--border` appears in no pairing — a subtle separator at 3:1 is a rule no
// considered neutral meets — so nothing else here would notice a theme that omitted it.
const REQUIRED = [
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
];

// Every pairing the components' utilities and the remaining stylesheets produce, read off
// them rather than off the palette. --success and --warning are absent as foregrounds on
// purpose: neither clears AA as text on --bg, which is why StatusBadge tints them instead.
const PAIRS = [
  { front: "fg", back: "bg", floor: AA_TEXT, label: "body text on the page" },
  { front: "fg", back: "surface", floor: AA_TEXT, label: "body text on a card" },
  { front: "fg", back: "muted", floor: AA_TEXT, label: "body text on a subtle fill" },
  { front: "fg-muted", back: "bg", floor: AA_TEXT, label: "secondary text on the page" },
  { front: "fg-muted", back: "surface", floor: AA_TEXT, label: "secondary text on a card" },
  { front: "fg-muted", back: "muted", floor: AA_TEXT, label: "placeholder text inside an input" },
  { front: "primary-fg", back: "primary", floor: AA_TEXT, label: "label on a primary button" },
  { front: "primary-fg", back: "danger", floor: AA_TEXT, label: "label on a danger button" },
  { front: "primary", back: "bg", floor: AA_TEXT, label: "link text on the page" },
  { front: "primary", back: "surface", floor: AA_TEXT, label: "link text on a card" },
  { front: "danger", back: "bg", floor: AA_TEXT, label: "field error text" },
  { front: "danger", back: "surface", floor: AA_TEXT, label: "field error text on a card" },
  { front: "primary", back: "muted", floor: AA_NON_TEXT, label: "an option's icon on its tile" },
  { front: "ring", back: "bg", floor: AA_NON_TEXT, label: "focus ring against the page" },
];

// oklch(L C H) -> linear sRGB. Unclamped, so the caller can see a channel leave [0,1]
// and call it out as out of gamut rather than quietly clipping it the way a browser does.
function linearRgb({ l, c, h }) {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);

  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  ];
}

// A hair of tolerance: the matrices are approximations and a channel landing at -0.0004
// is a rounding artefact, not a colour the display cannot show.
const EPSILON = 0.002;

function outOfGamut(color) {
  return linearRgb(color).some((v) => v < -EPSILON || v > 1 + EPSILON);
}

function luminance(color) {
  const [r = 0, g = 0, b = 0] = linearRgb(color).map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// `oklch(0.985 0.002 260)` and `oklch(1 0 0)`. Nothing else is accepted, and that is the
// point: a hex or an rgb() slipping into a theme file is a colour this script cannot
// reason about, so it has to be a failure rather than a skip.
const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/;

function parseColor(value) {
  const match = OKLCH.exec(value.trim());
  if (match === null) return null;
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

// One entry per selector block, because a theme declares one per mode and the two are
// checked separately -- a light block is not evidence about a dark one.
function blocks(source) {
  // Comments come out first, or one sitting above a declaration swallows it: the splits
  // below are on `;` and `:`, and a comment contains both.
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const pattern = /([^{}]+)\{([^}]*)\}/g;
  const found = [];
  let match = pattern.exec(stripped);

  while (match !== null) {
    const declarations = {};
    for (const line of (match[2] ?? "").split(";")) {
      const at = line.indexOf(":");
      if (at === -1) continue;
      const name = line.slice(0, at).trim();
      if (name.startsWith("--")) declarations[name.slice(2)] = line.slice(at + 1).trim();
    }
    found.push({ selector: (match[1] ?? "").trim().replace(/\s+/g, " "), declarations });
    match = pattern.exec(stripped);
  }

  return found;
}

const failures = [];
let checkedPairs = 0;
let checkedColors = 0;
let checkedBlocks = 0;

for (const file of readdirSync(COLOR_DIR).filter((f) => f.endsWith(".css"))) {
  const source = readFileSync(join(COLOR_DIR, file), "utf8");

  for (const { selector, declarations } of blocks(source)) {
    const where = `${file} ${selector}`;
    const parsed = {};
    checkedBlocks += 1;

    // Once per block and by name, rather than once per pairing and by inference. A theme
    // that omits a name inherits whatever the `:root` seed left, which is another theme's.
    for (const name of REQUIRED) {
      if (!(name in declarations)) failures.push(`${where} -- missing --${name}`);
    }

    for (const [name, raw] of Object.entries(declarations)) {
      const color = parseColor(raw);
      if (color === null) {
        failures.push(`${where} -- --${name} is not an oklch() triple: ${raw}`);
        continue;
      }
      checkedColors += 1;
      parsed[name] = color;

      if (outOfGamut(color)) {
        failures.push(
          `${where} -- --${name} is outside sRGB: ${raw}. The browser clips it, so the shipped colour is not this one.`,
        );
      }
    }

    for (const { front, back, floor, label } of PAIRS) {
      const a = parsed[front];
      const b = parsed[back];

      // Already reported — either as a missing name above or as an unparseable value.
      // Guessing which of the two to blame is what this used to do, and it guessed wrong
      // whenever both were absent.
      if (!a || !b) continue;

      checkedPairs += 1;
      const value = ratio(a, b);
      if (value < floor) {
        failures.push(
          `${where} -- ${label}: ${value.toFixed(2)}:1, needs ${floor}:1 (--${front} on --${back})`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`x ${failure}`);
  console.error(`\n${failures.length} colour failures.`);
  process.exit(1);
}

console.log(
  `OK ${checkedPairs} pairings meet WCAG AA and ${checkedColors} colours are inside sRGB, ` +
    `all ${REQUIRED.length} names present in ${checkedBlocks} blocks, across every theme and mode.`,
);
