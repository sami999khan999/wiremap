import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeRefetch } from "../../src/realtime/realtime-refetch.js";

const KEY = ["message", "list", "00000000-0000-7000-8000-000000000001"] as const;

describe("RealtimeRefetch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // The busy-room case: one refetch now and one trailing, not one per frame.
  it("turns a burst of twenty frames into two refetches", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
    const refetch = new RealtimeRefetch(client);

    for (let frame = 0; frame < 20; frame += 1) refetch.request(KEY);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY });
  });

  it("keeps separate keys independent", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
    const refetch = new RealtimeRefetch(client);

    refetch.request(KEY);
    refetch.request(["member"]);
    await vi.advanceTimersByTimeAsync(0);

    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("drops the trailing run once disposed", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
    const refetch = new RealtimeRefetch(client);

    refetch.request(KEY);
    refetch.request(KEY);
    refetch.dispose();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
