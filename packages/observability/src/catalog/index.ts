import type { LogLevel } from "../primitive/index.js";
import { coreEvents } from "./core.events.js";

export interface EventMeta {
  // Decided here, never at the call site. A code meaning "a job failed" is an error
  // everywhere, so no adapter can emit it at `info`.
  readonly level: LogLevel;
  // 0..1, omitted means always. The volume dial, per code — the lever that works
  // when one hot path is the whole bill.
  readonly sample?: number;
}

// The closed vocabulary of things worth writing down, merged from team-owned
// fragments. Add them here — `...billingEvents`.
export const EVENT_CATALOG = {
  ...coreEvents,
} as const;

export type EventCode = keyof typeof EVENT_CATALOG;
