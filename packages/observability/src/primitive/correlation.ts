import { TraceIds, Uuid } from "../import.js";

// A plain string, not a branded id: it has to survive arriving from a proxy that minted
// its own, in whatever shape.
export type TraceId = string;

export class Correlation {
  private constructor() {}

  // The de-facto header: adopting an upstream's is what makes their access log and ours
  // one trace.
  public static readonly HEADER = "x-request-id";

  // Bounded and character-checked, and the rule lives in `errors` rather than here:
  // `AppError.from` rebuilds a trace id off the wire too, and one rule cannot drift.
  public static sanitise(value: string | null | undefined): TraceId | null {
    return TraceIds.sanitise(value);
  }

  // v7, so a trace id sorts by time — the same reason every id in this repo is v7.
  public static mint(): TraceId {
    return Uuid.v7();
  }

  public static fromHeaders(headers: { get(name: string): string | null }): TraceId {
    return Correlation.sanitise(headers.get(Correlation.HEADER)) ?? Correlation.mint();
  }
}
