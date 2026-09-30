import type { ApiClient } from "@loadbearing/api-client";
import type { RealtimeMessage } from "@loadbearing/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryKeys } from "../../src/key/index.js";
import { useConversationStream } from "../../src/messaging/use-conversation-stream.js";

const CONVERSATION = "00000000-0000-7000-8000-000000000001";
const ME = "00000000-0000-7000-8000-00000000000a";
const THEM = "00000000-0000-7000-8000-00000000000b";

const typing = (userId: string): RealtimeMessage => ({
  kind: "typing",
  id: "00000000-0000-7000-8000-0000000000ff",
  conversationId: CONVERSATION,
  userId,
  at: new Date("2026-01-01T00:00:00Z"),
});

// Yields its frames and then parks, the way a real stream does between them, so the
// spec reads the state without racing the generator's completion.
function clientYielding(messages: readonly RealtimeMessage[]): ApiClient {
  return {
    realtime: {
      conversation: () =>
        Promise.resolve(
          (async function* () {
            for (const message of messages) yield message;
            await new Promise(() => {});
          })(),
        ),
    },
  } as unknown as ApiClient;
}

function Probe({ client, selfId }: { readonly client: ApiClient; readonly selfId?: string }) {
  const { typing: names } = useConversationStream(client, CONVERSATION, selfId);
  return createElement("span", { "data-testid": "typing" }, names.join(","));
}

const tree = (client: ApiClient, selfId?: string) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient() },
    createElement(Probe, { client, selfId }),
  );

describe("useConversationStream typing", () => {
  it("renders somebody else typing", async () => {
    const screen = render(tree(clientYielding([typing(THEM)]), ME));

    await waitFor(() => expect(screen.getByTestId("typing").textContent).toBe(THEM));
  });

  // `23.25`: the frame is addressed to the whole conversation channel, author included,
  // so without this the person typing was told that they were typing.
  it("does not render the reader typing at themselves", async () => {
    const screen = render(tree(clientYielding([typing(ME), typing(THEM)]), ME));

    // The reader's frame is yielded *first*, and this waits for the one after it. An
    // ──
    // assertion that the text is empty would pass before any frame landed at all, which
    // is a spec that goes green against the defect it was written for.
    await waitFor(() => expect(screen.getByTestId("typing").textContent).toBe(THEM));
    expect(screen.getByTestId("typing").textContent).not.toContain(ME);
  });

  // A caller that passes no id is unchanged, which is what keeps this additive.
  it("renders every frame when no reader id is given", async () => {
    const screen = render(tree(clientYielding([typing(ME)])));

    await waitFor(() => expect(screen.getByTestId("typing").textContent).toBe(ME));
  });
});

const sent = (frameId: string, messageId: string): RealtimeMessage => ({
  kind: "event",
  id: frameId,
  name: "message.sent",
  at: new Date("2026-01-01T00:00:00Z"),
  payload: { conversationId: CONVERSATION, messageId },
});

describe("useConversationStream messages", () => {
  // The request's frame and the outbox's frame for one send: one refresh, not two.
  it("refreshes the newest page once for a send it hears twice", async () => {
    const MESSAGE = "00000000-0000-7000-8000-0000000000d1";
    const list = vi.fn(() => Promise.resolve({ items: [], olderCursor: null }));
    const client = {
      message: { list },
      realtime: {
        conversation: () =>
          Promise.resolve(
            (async function* () {
              yield sent("00000000-0000-7000-8000-0000000000f1", MESSAGE);
              yield sent("00000000-0000-7000-8000-0000000000f2", MESSAGE);
              await new Promise(() => {});
            })(),
          ),
      },
    } as unknown as ApiClient;

    const queryClient = new QueryClient();
    queryClient.setQueryData(QueryKeys.message.list(CONVERSATION), {
      pages: [{ items: [], olderCursor: null }],
      pageParams: [undefined],
    });

    render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(Probe, { client })),
    );

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(list).toHaveBeenCalledTimes(1);
  });

  // `CP1.9`, measured in two Chrome tabs: twenty sends 110 ms apart were twenty fetches in
  // each tab, because the single flight had no floor. A burst is now about one a second.
  it("refreshes a burst of distinct sends about once a second, not once each", async () => {
    const list = vi.fn(() => Promise.resolve({ items: [], olderCursor: null }));
    const client = {
      message: { list },
      realtime: {
        conversation: () =>
          Promise.resolve(
            (async function* () {
              for (let index = 0; index < 10; index += 1) {
                yield sent(
                  `00000000-0000-7000-8000-0000000001${String(index).padStart(2, "0")}`,
                  `00000000-0000-7000-8000-0000000002${String(index).padStart(2, "0")}`,
                );
                await new Promise((resolve) => setTimeout(resolve, 90));
              }
              await new Promise(() => {});
            })(),
          ),
      },
    } as unknown as ApiClient;

    const queryClient = new QueryClient();
    queryClient.setQueryData(QueryKeys.message.list(CONVERSATION), {
      pages: [{ items: [], olderCursor: null }],
      pageParams: [undefined],
    });

    render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(Probe, { client })),
    );

    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(list.mock.calls.length).toBeLessThanOrEqual(2);
  });

  // An edit can land on any loaded page, so it refetches the list rather than one page.
  it("refetches the list for an edit", async () => {
    const client = clientYielding([
      {
        kind: "event",
        id: "00000000-0000-7000-8000-0000000000f3",
        name: "message.edited",
        at: new Date("2026-01-01T00:00:00Z"),
        payload: {
          conversationId: CONVERSATION,
          messageId: "00000000-0000-7000-8000-0000000000d2",
        },
      },
    ]);
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);

    render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(Probe, { client })),
    );

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: QueryKeys.message.list(CONVERSATION) }),
    );
  });
});
