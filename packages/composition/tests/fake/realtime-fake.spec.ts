import { describe, expect, it } from "vitest";
import {
  InMemoryRealtimeHub,
  InMemoryRealtimeSubscriber,
  RecordingRealtimePublisher,
} from "../../src/fake/index.js";
import { RealtimeChannels, type RealtimeMessage } from "../../src/import.js";

const ORG = "00000000-0000-7000-8000-000000000001";
const USER = "00000000-0000-7000-8000-000000000002";
const CHANNEL = RealtimeChannels.user(ORG, USER);

const frame = (id: string): RealtimeMessage => ({
  kind: "event",
  id,
  name: "member.changed",
  at: new Date("2026-01-01T00:00:00Z"),
  payload: {},
});

// Reads `count` frames and then stops the stream, so a spec never depends on a generator
// that would otherwise park forever waiting for the next publish.
async function take(
  stream: AsyncIterable<RealtimeMessage>,
  count: number,
  controller: AbortController,
): Promise<readonly RealtimeMessage[]> {
  const received: RealtimeMessage[] = [];

  for await (const message of stream) {
    received.push(message);
    if (received.length >= count) break;
  }

  controller.abort();
  return received;
}

describe("the realtime fakes", () => {
  it("delivers a published frame to a subscriber on the same channel", async () => {
    const hub = new InMemoryRealtimeHub();
    const publisher = new RecordingRealtimePublisher(hub);
    const subscriber = new InMemoryRealtimeSubscriber(hub);
    const controller = new AbortController();

    const reading = take(subscriber.subscribe([CHANNEL], controller.signal), 1, controller);
    await Promise.resolve();
    await publisher.publish(CHANNEL, frame("00000000-0000-7000-8000-00000000000a"));

    expect((await reading).map((message) => message.id)).toEqual([
      "00000000-0000-7000-8000-00000000000a",
    ]);
  });

  // The tenancy claim in one assertion: a channel is the whole of it, so a subscriber on
  // a different one must receive nothing rather than receive and filter.
  it("does not deliver across channels", async () => {
    const hub = new InMemoryRealtimeHub();
    const publisher = new RecordingRealtimePublisher(hub);
    const subscriber = new InMemoryRealtimeSubscriber(hub);
    const controller = new AbortController();
    const other = RealtimeChannels.user(ORG, "00000000-0000-7000-8000-000000000003");

    const received: RealtimeMessage[] = [];
    const reading = (async () => {
      for await (const message of subscriber.subscribe([other], controller.signal)) {
        received.push(message);
      }
    })();

    await Promise.resolve();
    await publisher.publish(CHANNEL, frame("00000000-0000-7000-8000-00000000000b"));
    controller.abort();
    await reading;

    expect(received).toEqual([]);
    expect(publisher.publishedOn(CHANNEL)).toHaveLength(1);
  });

  it("releases its listener when the stream ends", async () => {
    const hub = new InMemoryRealtimeHub();
    const subscriber = new InMemoryRealtimeSubscriber(hub);
    const controller = new AbortController();

    const reading = (async () => {
      for await (const _ of subscriber.subscribe([CHANNEL], controller.signal)) {
        // The loop body is unreachable: nothing publishes on this channel.
      }
    })();

    await Promise.resolve();
    expect(hub.listenerCount(CHANNEL)).toBe(1);

    controller.abort();
    await reading;

    expect(hub.listenerCount(CHANNEL)).toBe(0);
  });

  // Without the hub the publisher still records, which is what every existing spec
  // asserts off and what the default in `TestContainer` builds.
  it("records without a hub", async () => {
    const publisher = new RecordingRealtimePublisher();

    await publisher.publish(CHANNEL, frame("00000000-0000-7000-8000-00000000000c"));

    expect(publisher.published()).toHaveLength(1);
  });
});
