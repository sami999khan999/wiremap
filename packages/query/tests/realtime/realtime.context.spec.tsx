import type { ApiClient } from "@loadbearing/api-client";
import type { RealtimeMessage } from "@loadbearing/contracts";
import { UnauthorizedError } from "@loadbearing/errors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryKeys } from "../../src/key/index.js";
import { RealtimeProvider, useRealtime } from "../../src/realtime/realtime.context.js";

const frame = (name: "member.changed" | "notification.created"): RealtimeMessage => ({
  kind: "event",
  id: "00000000-0000-7000-8000-00000000000a",
  name,
  at: new Date("2026-01-01T00:00:00Z"),
  payload: {},
});

// A stream that yields what it is given and then parks, the way a real one does between
// frames — so a spec sees the frames without racing the generator's completion.
function clientYielding(messages: readonly RealtimeMessage[]): ApiClient {
  return {
    realtime: {
      stream: () =>
        Promise.resolve(
          (async function* () {
            for (const message of messages) yield message;
            await new Promise(() => {});
          })(),
        ),
    },
  } as unknown as ApiClient;
}

function Probe() {
  const { connected } = useRealtime();
  return createElement("span", { "data-testid": "state" }, connected ? "on" : "off");
}

const ORG = "00000000-0000-7000-8000-000000000001";

const tree = (client: ApiClient, queryClient: QueryClient, organizationId: string | null) =>
  createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(RealtimeProvider, {
      client,
      organizationId,
      children: createElement(Probe),
    } as {
      client: ApiClient;
      organizationId: string | null;
      children: ReactNode;
    }),
  );

const mount = (client: ApiClient, organizationId: string | null = ORG) => {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);

  const view = render(tree(client, queryClient, organizationId));

  return { view, invalidate, queryClient };
};

describe("RealtimeProvider", () => {
  it("routes each frame through the table", async () => {
    const { invalidate } = mount(clientYielding([frame("notification.created")]));

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: QueryKeys.notification.unreadCount() }),
    );
  });

  // A resync means frames were lost, and the gap could have held any of them — so it
  // sweeps every key the table names rather than the one the frame happens to carry.
  it("sweeps every routed key on a resync", async () => {
    const resync: RealtimeMessage = { kind: "resync", id: "00000000-0000-7000-8000-00000000000b" };
    const { invalidate } = mount(clientYielding([resync]));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: QueryKeys.member.all() });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: QueryKeys.conversation.all() });
    });
  });

  it("reports connected once the stream opens", async () => {
    const { view } = mount(clientYielding([]));

    await waitFor(() => expect(view.getByTestId("state").textContent).toBe("on"));
  });

  // A stream that fails to open is retried with backoff, never a rendered error: the tab
  // keeps working meanwhile.
  it("stays mounted and disconnected when the stream cannot open", async () => {
    const stream = vi.fn(() => Promise.reject(new Error("UNAVAILABLE")));
    const { view } = mount({ realtime: { stream } } as unknown as ApiClient);

    // The attempt first. `off` is also the state before the effect has run, so asserting
    // it alone passed against a provider that never opened anything.
    await waitFor(() => expect(stream).toHaveBeenCalled());

    expect(view.getByTestId("state").textContent).toBe("off");
    expect(view.getByTestId("state")).toBeTruthy();
  });

  // The transition the case above cannot show: connected, then the stream ends. It is
  // reopened, which is `CR.37`; here the reopen is refused, so the tab settles on "off".
  it("reopens a stream that ended, and stops when the reopen is refused", async () => {
    let end: (() => void) | undefined;
    const stream = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(
          (async function* (): AsyncGenerator<RealtimeMessage> {
            await new Promise<void>((resolve) => {
              end = resolve;
            });
          })(),
        ),
      )
      .mockImplementation(() => Promise.reject(new UnauthorizedError()));

    const { view } = mount({ realtime: { stream } } as unknown as ApiClient);
    await waitFor(() => expect(view.getByTestId("state").textContent).toBe("on"));

    await act(async () => {
      end?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(stream).toHaveBeenCalledTimes(2), { timeout: 3_000 });
    await waitFor(() => expect(view.getByTestId("state").textContent).toBe("off"));
    // Signed out is an answer: nothing asks again.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(stream).toHaveBeenCalledTimes(2);
  });
  // The server builds the channel from the principal when the stream opens, so a switch
  // that does not reopen leaves the tab reading the tenant it just left.
  it("reopens the stream when the active tenant changes", async () => {
    const opened: number[] = [];
    const client = {
      realtime: {
        stream: () => {
          opened.push(opened.length);
          return Promise.resolve(
            (async function* (): AsyncGenerator<RealtimeMessage> {
              await new Promise(() => {});
            })(),
          );
        },
      },
    } as unknown as ApiClient;

    const queryClient = new QueryClient();
    vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);

    const view = render(tree(client, queryClient, ORG));
    await waitFor(() => expect(opened).toHaveLength(1));

    view.rerender(tree(client, queryClient, "00000000-0000-7000-8000-000000000002"));

    await waitFor(() => expect(opened).toHaveLength(2));
  });

  // Before there is a tenant there is no channel to open, and the request would 401 and
  // then retry forever on the plugin's infinite budget.
  it("opens nothing while there is no active tenant", async () => {
    const stream = vi.fn();
    mount({ realtime: { stream } } as unknown as ApiClient, null);

    await waitFor(() => expect(stream).not.toHaveBeenCalled());
  });
});
