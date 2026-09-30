import type { QueryKey, RealtimeEventName, RealtimeMessage } from "../import.js";
import { QueryKeys } from "../key/index.js";

type Payload = Extract<RealtimeMessage, { kind: "event" }>["payload"];
type Request = (queryKey: QueryKey) => void;

// Total over the event name union, so a name added to the contract is a compile error
// here rather than a frame that arrives and does nothing.
type RouteTable = Readonly<Record<RealtimeEventName, (request: Request, payload: Payload) => void>>;

export class RealtimeRoutes {
  private constructor() {}

  // Refetch, never patch from a payload: the ids in it only narrow *which* keys. An empty
  // payload — and every resync — falls back to the whole namespace.
  private static readonly TABLE: RouteTable = Object.freeze({
    "member.changed": (request) => request(QueryKeys.member.all()),
    "notification.created": (request) => {
      request(QueryKeys.notification.unreadCount());
      request(QueryKeys.notification.lists());
    },
  });

  public static apply(request: Request, name: RealtimeEventName, payload: Payload): void {
    RealtimeRoutes.TABLE[name](request, payload);
  }

  // What a `resync` refetches: every route with no ids, because the gap could have held
  // any of them. Derived from the table rather than listed twice.
  public static resync(request: Request): void {
    for (const route of Object.values(RealtimeRoutes.TABLE)) route(request, {});
  }

  public static names(): readonly RealtimeEventName[] {
    return Object.keys(RealtimeRoutes.TABLE) as readonly RealtimeEventName[];
  }
}
