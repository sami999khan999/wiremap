import { RealtimeChannels, type RealtimeMessage, withEventMeta } from "../import.js";
import { authed } from "./base.js";
import { StreamRevalidation } from "./stream-revalidation.js";

// Reconnect delay the client honours through `ClientRetryPlugin`, whose `retryDelay`
// default reads exactly this off the last frame.
const RETRY_MS = 2_000;

// How often an open stream asks again whether its principal may still hold it. A minute
// of frames after a removal, where there were thirty (`CR.4`).
const REVALIDATE_MS = 60_000;

// The stream, and nothing else. One namespace is one process: `apps/realtime` mounts this
// router and the browser sends every `realtime.*` path to it.
export class RealtimeRouter {
  private constructor() {}

  // Every frame carries its SSE id, which is the point a reconnecting client resumes from.
  private static framed(message: RealtimeMessage) {
    return withEventMeta(message, { id: message.id, retry: RETRY_MS });
  }

  // The channel is built from the principal, never from input. That is the whole of the
  // authorisation: you cannot ask for a stream that is not yours.
  public static readonly stream = authed.realtime.stream.handler(async function* ({
    context,
    signal,
    lastEventId,
  }) {
    const channel = RealtimeChannels.user(
      context.principal.organizationId,
      context.principal.userId,
    );

    const startedAt = Date.now();
    let frames = 0;
    context.log.emit("realtime.stream.opened", { resumed: lastEventId !== undefined });
    // A deactivated member's stream ends; the reopen is refused, and the client stops.
    const watched = StreamRevalidation.watch(
      signal as AbortSignal,
      () =>
        context.container.memberships.isActive(
          context.principal.userId,
          context.principal.organizationId,
        ),
      REVALIDATE_MS,
    );

    try {
      for await (const message of context.container.realtimeSubscriber.subscribe(
        [channel],
        watched.signal,
        // The resume point, when there is one: the subscriber replays what came after it,
        // or yields a `resync` when its log no longer reaches back that far (`26.5`).
        { owner: channel, ...(lastEventId === undefined ? {} : { after: lastEventId }) },
      )) {
        frames += 1;
        yield RealtimeRouter.framed(message);
      }
    } finally {
      watched.stop();
      context.log.emit("realtime.stream.closed", { durationMs: Date.now() - startedAt, frames });
    }
  });

  public static readonly all = {
    stream: RealtimeRouter.stream,
  };
}
