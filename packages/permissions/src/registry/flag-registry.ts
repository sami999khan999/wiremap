import { FLAGS } from "../flag/index.js";
import { WIDGETS } from "../widget/index.js";

// Declared in code, switched in Postgres. `expiresOn` is `YYYY-MM-DD`, and CI fails a flag
// past it: a flag is a rollout, and one nobody deletes becomes a permanent branch.
export interface FlagMeta {
  readonly owner: string;
  readonly expiresOn: string;
  readonly description: string;
}

export type FlagKey = keyof typeof FLAGS;

const ALL_KEYS: readonly FlagKey[] = Object.freeze(Object.keys(FLAGS) as FlagKey[]);

// Derived from the widgets that name a flag, never declared by hand. Only these reach the
// session payload; a server-only flag's name never leaves the server.
const CLIENT_GATING: ReadonlySet<FlagKey> = new Set(
  Object.values(WIDGETS).flatMap((widget): FlagKey[] =>
    "flag" in widget && typeof widget.flag === "string" ? [widget.flag as FlagKey] : [],
  ),
);

const CLIENT_GATING_KEYS: readonly FlagKey[] = Object.freeze(
  ALL_KEYS.filter((key) => CLIENT_GATING.has(key)),
);

export class FlagRegistry {
  public static readonly instance = new FlagRegistry();

  private constructor() {}

  public all(): readonly FlagKey[] {
    return ALL_KEYS;
  }

  // `undefined`, not a throw — a database row naming a deleted flag is an orphan to show.
  public meta(key: string): FlagMeta | undefined {
    return this.isKnown(key) ? FLAGS[key] : undefined;
  }

  // `Object.hasOwn`, not `in` — `in` walks the prototype chain and admits `constructor`.
  public isKnown(value: string): value is FlagKey {
    return Object.hasOwn(FLAGS, value);
  }

  public isClientGating(key: FlagKey): boolean {
    return CLIENT_GATING.has(key);
  }

  public clientGating(): readonly FlagKey[] {
    return CLIENT_GATING_KEYS;
  }
}
