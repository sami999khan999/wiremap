import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { type AppMutationOptions, useAppMutation } from "../../src/runtime/use-app-mutation.js";

const LIST = ["sessions", "list"] as const;
const OTHER = ["members", "list"] as const;

interface Row {
  readonly id: string;
}

// Retries off, or a rejected mutation takes three attempts before `onError` runs and the
// rollback assertion below waits on a timer instead of on the code under test.
const harness = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);

  return { client, wrapper };
};

const mount = <TData, TVariables, TCache>(
  wrapper: ({ children }: { children: ReactNode }) => ReactNode,
  options: AppMutationOptions<TData, TVariables, TCache>,
) => renderHook(() => useAppMutation<TData, TVariables, TCache>(options), { wrapper });

describe("useAppMutation — invalidation", () => {
  // A caller that navigates on success must not race the refetch of the screen it is
  // leaving, which is why the order is fixed here rather than left to each call site.
  it("invalidates before it calls the caller's onSuccess", async () => {
    const { client, wrapper } = harness();
    const order: string[] = [];

    client.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "invalidate") {
        order.push("invalidate");
      }
    });
    client.setQueryData(LIST, [{ id: "a" }]);

    const { result } = mount<void, void, Row[]>(wrapper, {
      mutationFn: () => Promise.resolve(),
      invalidates: [LIST],
      onSuccess: () => {
        order.push("onSuccess");
      },
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(order).toEqual(["invalidate", "onSuccess"]);
  });

  // An edit the server never confirmed would otherwise stay on screen until something
  // else happened to refetch that key.
  it("invalidates the optimistic key even when `invalidates` does not name it", async () => {
    const { client, wrapper } = harness();
    const invalidated: unknown[] = [];

    client.setQueryData(LIST, [{ id: "a" }]);
    client.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "invalidate") {
        invalidated.push(event.query.queryKey);
      }
    });

    const { result } = mount<void, void, Row[]>(wrapper, {
      mutationFn: () => Promise.resolve(),
      optimistic: { queryKey: LIST, apply: (cached) => cached },
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(invalidated).toEqual([[...LIST]]);
  });

  it("does not invalidate the optimistic key twice when `invalidates` names it", async () => {
    const { client, wrapper } = harness();
    const invalidated: unknown[] = [];

    client.setQueryData(LIST, [{ id: "a" }]);
    client.setQueryData(OTHER, [{ id: "b" }]);
    client.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "invalidate") {
        invalidated.push(event.query.queryKey);
      }
    });

    const { result } = mount<void, void, Row[]>(wrapper, {
      mutationFn: () => Promise.resolve(),
      invalidates: [LIST, OTHER],
      optimistic: { queryKey: LIST, apply: (cached) => cached },
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(invalidated).toEqual([[...LIST], [...OTHER]]);
  });
});

describe("useAppMutation — the optimistic edit", () => {
  it("applies the edit before the request resolves", async () => {
    const { client, wrapper } = harness();
    let release = () => {};
    const settled = new Promise<void>((resolve) => {
      release = resolve;
    });

    client.setQueryData(LIST, [{ id: "a" }, { id: "b" }]);

    const { result } = mount<void, string, Row[]>(wrapper, {
      mutationFn: () => settled,
      optimistic: {
        queryKey: LIST,
        apply: (cached, id) => cached.filter((row) => row.id !== id),
      },
    });

    act(() => {
      result.current.mutate("a");
    });

    await waitFor(() => {
      expect(client.getQueryData<Row[]>(LIST)).toEqual([{ id: "b" }]);
    });

    await act(async () => {
      release();
      await settled;
    });
  });

  // `previous` is undefined when the list is simply not on screen, and writing an edit
  // into a key nothing has read seeds the cache with a value no server ever sent.
  it("writes nothing when the key holds no data", async () => {
    const { client, wrapper } = harness();

    const { result } = mount<void, string, Row[]>(wrapper, {
      mutationFn: () => Promise.resolve(),
      optimistic: { queryKey: LIST, apply: () => [{ id: "invented" }] },
    });

    await act(async () => {
      await result.current.mutateAsync("a");
    });

    expect(client.getQueryData(LIST)).toBeUndefined();
  });

  // The whole reason `onMutate` cancels first: a refetch already in flight resolves with
  // the server's pre-mutation answer and puts the row straight back.
  it("cancels queries on the key before it writes", async () => {
    const { client, wrapper } = harness();
    const order: string[] = [];

    client.setQueryData(LIST, [{ id: "a" }]);

    // The call itself, not a cache event that every optimistic write produces: the old
    // assertion was `seen` containing "success", which holds with no cancel at all.
    const cancel = vi
      .spyOn(client, "cancelQueries")
      .mockImplementation(async (filters?: { queryKey?: readonly unknown[] }) => {
        order.push(`cancel:${JSON.stringify(filters?.queryKey)}`);
        return Promise.resolve();
      });

    client.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") return;
      if (event.action.type !== "success") return;
      order.push("write");
    });

    const { result } = mount<void, string, Row[]>(wrapper, {
      mutationFn: () => Promise.resolve(),
      optimistic: { queryKey: LIST, apply: () => [] },
    });

    await act(async () => {
      await result.current.mutateAsync("a");
    });

    expect(cancel).toHaveBeenCalledWith({ queryKey: LIST });
    // A refetch already in flight resolves with the server's pre-mutation answer, so a
    // cancel after the write puts the row straight back.
    expect(order[0]).toBe(`cancel:${JSON.stringify(LIST)}`);
    expect(order).toContain("write");

    cancel.mockRestore();
  });
});

describe("useAppMutation — rollback", () => {
  // Restored before the caller's handler runs, which may render the failure beside the
  // row that has to be back on screen for the message to mean anything.
  it("restores the snapshot, and does so before the caller's onError", async () => {
    const { client, wrapper } = harness();
    let atError: Row[] | undefined;

    client.setQueryData(LIST, [{ id: "a" }, { id: "b" }]);

    const { result } = mount<void, string, Row[]>(wrapper, {
      // Rejected on a later tick: an immediate rejection batches the edit and the
      // rollback into one render, and the spec then proves nothing about the order.
      mutationFn: () =>
        new Promise<void>((_resolve, reject) => {
          setTimeout(() => reject(new Error("nope")), 0);
        }),
      optimistic: {
        queryKey: LIST,
        apply: (cached, id) => cached.filter((row) => row.id !== id),
      },
      onError: () => {
        atError = client.getQueryData<Row[]>(LIST);
      },
    });

    await act(async () => {
      await result.current.mutateAsync("a").catch(() => undefined);
    });

    expect(atError).toEqual([{ id: "a" }, { id: "b" }]);
    expect(client.getQueryData<Row[]>(LIST)).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("still calls the caller's onError when there was no optimistic edit", async () => {
    const { wrapper } = harness();
    let called = false;

    const { result } = mount<void, void, never>(wrapper, {
      mutationFn: () => Promise.reject(new Error("nope")),
      onError: () => {
        called = true;
      },
    });

    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });

    expect(called).toBe(true);
  });
});
