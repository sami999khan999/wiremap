import type { HttpMethod } from "../import.js";
import { RoutePath } from "../plugin/index.js";
import type { FoundCall } from "./call-extractor.js";

export interface MatchableRoute {
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
}

// A call to the route it reaches, in any repository: segment by segment, the most literal
// match winning. Certain only for a literal URL matched whole. See docs/reference/pipeline.md.
export class RouteMatcher {
  private readonly routes: { route: MatchableRoute; segments: string[] }[];

  public constructor(routes: readonly MatchableRoute[]) {
    this.routes = routes.map((route) => ({ route, segments: RouteMatcher.segments(route.path) }));
  }

  public match(
    call: FoundCall,
  ): { readonly route: MatchableRoute; readonly certain: boolean } | null {
    const segments = RouteMatcher.segments(call.url);
    let best: { route: MatchableRoute; score: number; suffix: boolean } | null = null;
    for (const candidate of this.routes) {
      if (candidate.route.method !== "ANY" && candidate.route.method !== call.method) continue;
      const whole = RouteMatcher.score(segments, candidate.segments);
      // A base URL like `/api` the frontend sets once: the call's path ends the route's.
      const offset = candidate.segments.length - segments.length;
      const tail =
        whole === null && offset > 0
          ? RouteMatcher.score(segments, candidate.segments.slice(offset))
          : null;
      const score = whole ?? tail;
      if (score === null) continue;
      if (!best || score > best.score || (score === best.score && best.suffix && whole !== null)) {
        best = { route: candidate.route, score, suffix: whole === null };
      }
    }
    if (!best) return null;
    return { route: best.route, certain: call.literal && !call.based && !best.suffix };
  }

  // Two points a literal segment, one a parameter. At least one literal must agree: a lone
  // `/health` is not a call to `/users/:id` because both have one segment a parameter fills.
  private static score(call: readonly string[], route: readonly string[]): number | null {
    if (call.length !== route.length) return null;
    let score = 0;
    let literal = call.length === 0;
    for (let index = 0; index < call.length; index += 1) {
      const a = call[index] as string;
      const b = route[index] as string;
      if (a === b && a !== ":param") {
        score += 2;
        literal = true;
      } else if (a === ":param" || b === ":param") score += 1;
      else return null;
    }
    return literal ? score : null;
  }

  private static segments(path: string): string[] {
    return RoutePath.shape(path)
      .split("/")
      .filter((segment) => segment !== "")
      .map((segment) => (segment.endsWith("*") ? ":param" : segment));
  }
}
