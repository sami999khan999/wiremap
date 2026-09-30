import type { Container } from "@loadbearing/composition";
import { describe, expect, it } from "vitest";
import { RealtimeBootstrap } from "../../src/bootstrap/realtime-bootstrap.js";
import type { StreamListener } from "../../src/server/stream-listener.js";

const harness = (drain: () => Promise<number>) => {
  const steps: string[] = [];
  const events: { event: string; fields: unknown }[] = [];

  const container = {
    logger: {
      emit: (event: string, fields: unknown) => events.push({ event, fields }),
      failure: () => {},
    },
    realtimeSubscriber: {
      drain: () => {
        steps.push("drain");
        return drain();
      },
    },
    dispose: () => {
      steps.push("dispose");
      return Promise.resolve();
    },
  } as unknown as Container;

  const listener = {
    listen: () => Promise.resolve(),
    stopAccepting: () => steps.push("stopAccepting"),
    closed: () => {
      steps.push("closed");
      return Promise.resolve();
    },
    closeAll: () => steps.push("closeAll"),
  } as unknown as StreamListener;

  return { steps, events, bootstrap: new RealtimeBootstrap(container, listener, 40) };
};

describe("RealtimeBootstrap.stop", () => {
  // Stop taking streams, hand the open ones on, let them finish writing, then cut what is
  // left and close the pools. `closed` is what `CP7.5` found missing on Linux.
  it("stops accepting, drains, then closes, in that order", async () => {
    const { steps, events, bootstrap } = harness(() => Promise.resolve(3));

    await bootstrap.stop("SIGTERM");

    expect(steps).toEqual(["stopAccepting", "drain", "closed", "closeAll", "dispose"]);
    expect(events.find((line) => line.event === "realtime.stream.drained")?.fields).toMatchObject({
      streams: 3,
    });
  });

  // A stream that never ends must not hold the process past its budget.
  it("gives up on the drain when the budget runs out, and still closes", async () => {
    const { steps, events, bootstrap } = harness(() => new Promise<number>(() => {}));

    await bootstrap.stop("SIGTERM");

    expect(steps).toEqual(["stopAccepting", "drain", "closed", "closeAll", "dispose"]);
    expect(events.find((line) => line.event === "realtime.stream.drained")?.fields).toMatchObject({
      streams: -1,
    });
  });

  it("joins a stop already running rather than starting a second", async () => {
    const { steps, bootstrap } = harness(() => Promise.resolve(0));

    await Promise.all([bootstrap.stop("SIGTERM"), bootstrap.stop("SIGINT")]);

    expect(steps.filter((step) => step === "drain")).toHaveLength(1);
  });
});
