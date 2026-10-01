import type { DehydratedState } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArticleHtmlStore } from "../../src/store/article-html.store.js";

const page = (id: string, html: string) => ({
  id,
  spaceId: "s",
  title: "T",
  description: null,
  html,
  toc: [],
  markdown: "m",
  revisionNo: 1,
  publishedAt: new Date(0),
});
const reading = (id: string, html: string) => ({ space: { slug: "guide" }, page: page(id, html) });

const state = (queries: { queryKey: unknown[]; data: unknown }[]): DehydratedState =>
  ({
    mutations: [],
    queries: queries.map(({ queryKey, data }) => ({
      queryKey,
      queryHash: JSON.stringify(queryKey),
      state: { data, status: "success" },
    })),
  }) as unknown as DehydratedState;

const dataOf = (dehydrated: DehydratedState, index: number) =>
  dehydrated.queries[index]?.state.data as never;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ArticleHtmlStore.strip", () => {
  // Both readers' cache shapes, and nothing else: the markup already carries the HTML.
  it("blanks the page HTML of both readers' queries and leaves the rest alone", () => {
    const docs = { reading: reading("a", "<p>a</p>"), cacheable: true };
    const input = state([
      { queryKey: ["doc", "read", "guide", ""], data: reading("b", "<p>b</p>") },
      { queryKey: ["docs", "read", "guide", "x"], data: docs },
      { queryKey: ["doc", "spaces"], data: { items: [{ html: "<p>kept</p>" }] } },
    ]);
    const out = ArticleHtmlStore.strip(input);

    expect((dataOf(out, 0) as { page: { html: string } }).page.html).toBe("");
    expect((dataOf(out, 1) as { reading: { page: { html: string } } }).reading.page.html).toBe("");
    expect(dataOf(out, 2)).toEqual({ items: [{ html: "<p>kept</p>" }] });
  });

  // The server's render reads its own cache after this runs, so this must copy.
  it("never changes the state it was given", () => {
    const original = reading("c", "<p>c</p>");
    ArticleHtmlStore.strip(state([{ queryKey: ["doc", "read", "g", ""], data: original }]));
    expect(original.page.html).toBe("<p>c</p>");
  });
});

describe("ArticleHtmlStore.resolve", () => {
  it("passes a reading with its HTML through untouched", () => {
    const full = reading("d", "<p>d</p>") as never;
    expect(ArticleHtmlStore.resolve(full)).toBe(full);
  });

  // Read once from the server's markup, then kept: by a return visit Prose has rewired it.
  it("reads a blanked page from the DOM once and keeps it by revision", () => {
    const querySelector = vi.fn(() => ({ innerHTML: "<p>from the server</p>" }));
    vi.stubGlobal("document", { querySelector });

    const blank = reading("e", "") as never;
    const first = ArticleHtmlStore.resolve(blank) as { page: { html: string } };
    const again = ArticleHtmlStore.resolve(blank) as { page: { html: string } };

    expect(first.page.html).toBe("<p>from the server</p>");
    expect(again.page.html).toBe("<p>from the server</p>");
    expect(querySelector).toHaveBeenCalledTimes(1);
  });
});
