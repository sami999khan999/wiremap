import { type RealtimeEventName, type RealtimeMessage, useEffect, useRef } from "../import.js";
import { subscribeToFrames } from "./realtime.context.js";

// For a component that wants the frame itself rather than the invalidation the route
// table already did — a typing indicator, which has no cache entry to invalidate.
export function useRealtimeEvent(
  name: RealtimeEventName,
  handler: (message: RealtimeMessage) => void,
): void {
  // Held in a ref so an inline handler does not resubscribe on every render, which
  // would drop frames arriving between the teardown and the next subscribe.
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(
    () =>
      subscribeToFrames((message) => {
        if (message.kind !== "event" || message.name !== name) return;
        latest.current(message);
      }),
    [name],
  );
}
