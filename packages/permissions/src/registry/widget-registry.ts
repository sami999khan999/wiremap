import type { CapabilitySet } from "../capability/index.js";
import { WIDGETS } from "../widget/index.js";
import type { FlagKey } from "./flag-registry.js";
import type { PermissionKey } from "./permission-registry.js";

// One zone, so no zone folder and no zone metadata: a tuple is the whole declaration.
export const ZONES = Object.freeze(["dashboard.main"] as const);

export type ZoneKey = (typeof ZONES)[number];

// `dismissible` means a user may hide it and an org admin may hide it for everyone.
export type WidgetPolicy = "required" | "dismissible";

interface WidgetBase {
  // Required, `null` included: an ungated widget says so rather than forgetting.
  readonly permission: PermissionKey | null;
  readonly flag?: FlagKey;
}

export interface ZoneWidgetMeta extends WidgetBase {
  readonly zone: ZoneKey;
  readonly order: number;
  // Absent means `required`. Dismissible is a decision somebody wrote down.
  readonly policy?: WidgetPolicy;
}

// No zone, so no route loads its preferences: an inline widget can only be required.
export interface InlineWidgetMeta extends WidgetBase {
  readonly zone?: undefined;
  readonly order?: undefined;
  readonly policy?: "required";
}

export type WidgetMeta = ZoneWidgetMeta | InlineWidgetMeta;

type Widgets = typeof WIDGETS;

export type WidgetKey = keyof Widgets;

export type ZoneWidgetKey<Z extends ZoneKey> = {
  [K in WidgetKey]: Widgets[K] extends { readonly zone: Z } ? K : never;
}[WidgetKey];

export type InlineWidgetKey = {
  [K in WidgetKey]: Widgets[K] extends { readonly zone: ZoneKey } ? never : K;
}[WidgetKey];

export type DismissibleWidgetKey = {
  [K in WidgetKey]: Widgets[K] extends { readonly policy: "dismissible" } ? K : never;
}[WidgetKey];

// Broadest cause first. `unregistered` is a preference row naming a widget code dropped.
export type WidgetVisibility =
  | "visible"
  | "hidden-by-flag"
  | "denied"
  | "hidden-by-admin"
  | "hidden-by-user"
  | "unregistered";

export interface WidgetFacts {
  readonly capabilities: CapabilitySet;
  // The on-set for this org. The session carries only client-gating flags, which is every
  // flag a widget can name.
  readonly flags: ReadonlySet<FlagKey>;
  // Strings, not keys: a stored row can outlive the widget it names.
  readonly hiddenByAdmin: ReadonlySet<string>;
  readonly hiddenByUser: ReadonlySet<string>;
  readonly goalId?: string;
}

const ALL_KEYS: readonly WidgetKey[] = Object.freeze(Object.keys(WIDGETS) as WidgetKey[]);

// `WidgetMeta`, not the literal: a lookup by key must see every field either shape has.
const META: ReadonlyMap<WidgetKey, WidgetMeta> = new Map(
  ALL_KEYS.map((key): [WidgetKey, WidgetMeta] => [key, WIDGETS[key]]),
);

const BY_ZONE: ReadonlyMap<ZoneKey, readonly WidgetKey[]> = new Map(
  ZONES.map((zone): [ZoneKey, readonly WidgetKey[]] => [
    zone,
    Object.freeze(
      ALL_KEYS.filter((key) => META.get(key)?.zone === zone).sort(
        (a, b) => (META.get(a)?.order ?? 0) - (META.get(b)?.order ?? 0),
      ),
    ),
  ]),
);

const NO_WIDGETS: readonly WidgetKey[] = Object.freeze([]);

export class WidgetRegistry {
  public static readonly instance = new WidgetRegistry();

  private constructor() {}

  public all(): readonly WidgetKey[] {
    return ALL_KEYS;
  }

  public isKnown(value: string): value is WidgetKey {
    return Object.hasOwn(WIDGETS, value);
  }

  // `undefined`, not a throw — a stale preference row must read as `unregistered`.
  public meta(key: string): WidgetMeta | undefined {
    return this.isKnown(key) ? META.get(key) : undefined;
  }

  // Sorted by `order`, required widgets and dismissible ones together.
  public forZone(zone: ZoneKey): readonly WidgetKey[] {
    return BY_ZONE.get(zone) ?? NO_WIDGETS;
  }

  public isDismissible(key: string): key is DismissibleWidgetKey {
    return this.meta(key)?.policy === "dismissible";
  }

  // Unregistered, flag, permission, admin, user — the first that hides it is the answer.
  // A required widget ignores both preferences, so a stale row cannot hide the nav.
  public visibilityOf(key: string, facts: WidgetFacts): WidgetVisibility {
    const meta = this.meta(key);
    if (!meta) return "unregistered";
    if (meta.flag && !facts.flags.has(meta.flag)) return "hidden-by-flag";
    if (meta.permission && !facts.capabilities.can(meta.permission, facts.goalId)) {
      return "denied";
    }
    if (meta.policy !== "dismissible") return "visible";
    if (facts.hiddenByAdmin.has(key)) return "hidden-by-admin";
    if (facts.hiddenByUser.has(key)) return "hidden-by-user";
    return "visible";
  }
}
