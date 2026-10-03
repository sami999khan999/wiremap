import type { FileRole, RoleTone } from "../import.js";

// Thirty roles onto six tones, by what a reader looks for: where requests enter, where data
// lives, where logic runs, what stands guard, what assembles a screen, and the rest.
const TONES: Readonly<Record<FileRole, RoleTone>> = {
  controller: "primary",
  resolver: "primary",
  gateway: "primary",
  route: "primary",
  api: "primary",
  page: "primary",
  repository: "cool",
  entity: "cool",
  model: "cool",
  dto: "cool",
  migration: "cool",
  request: "cool",
  service: "warm",
  job: "warm",
  event: "warm",
  policy: "warm",
  hook: "warm",
  guard: "warning",
  interceptor: "warning",
  pipe: "warning",
  filter: "warning",
  middleware: "warning",
  module: "success",
  layout: "success",
  component: "success",
  view: "success",
  utility: "neutral",
  test: "neutral",
  types: "neutral",
  config: "neutral",
  source: "neutral",
};

export class RoleTones {
  private constructor() {}

  public static of(role: FileRole): RoleTone {
    return TONES[role];
  }
}

// The app runs without Preflight, so a bare <button> keeps the browser's chrome. Every raw
// button in the explorer starts from this.
export const PLAIN_BUTTON =
  "cursor-pointer appearance-none border-0 bg-transparent font-[inherit] text-inherit";
