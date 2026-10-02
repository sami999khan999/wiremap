import type { AddressInfo } from "node:net";
import type { Container } from "@loadbearing/composition";
import { SilentLogger } from "@loadbearing/observability";
import { afterEach, describe, expect, it } from "vitest";
import { StreamListener } from "../../src/server/stream-listener.js";

// The listener's whole surface of the container, for the paths that never reach Redis: a
// logger, and a principal resolver that finds nobody.
const container = {
  logger: new SilentLogger(),
  principals: { fromHeaders: () => Promise.resolve(null) },
} as unknown as Container;

const open: StreamListener[] = [];

const start = async () => {
  const listener = new StreamListener(container, ["http://localhost:43000"]);
  open.push(listener);
  await listener.listen(0);
  const address = (listener as unknown as { server: { address: () => AddressInfo } }).server;
  return `http://localhost:${address.address().port}`;
};

afterEach(() => {
  for (const listener of open.splice(0)) {
    listener.stopAccepting();
    listener.closeAll();
  }
});

describe("StreamListener", () => {
  it("answers the liveness probe without touching the container", async () => {
    const base = await start();

    const response = await fetch(`${base}/healthz`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  // The same chain the web app runs: no session is the envelope's 401, not a hang.
  it("refuses a stream with no session through the shared chain", async () => {
    const base = await start();

    const response = await fetch(`${base}/api/realtime/realtime/stream`);

    expect(response.status).toBe(401);
  });

  // Only `realtime.*` is mounted here; every other procedure is the web app's.
  it("does not answer a procedure that is not a stream", async () => {
    const base = await start();

    const response = await fetch(`${base}/api/realtime/message/list`, { method: "POST" });

    expect(response.status).toBe(404);
  });
});
