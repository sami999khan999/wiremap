import type { DehydratedState, DocReadingDto } from "~/import.js";

type Page = NonNullable<DocReadingDto["page"]>;

// A page's HTML is in the server's markup already; sent again in the hydration payload it
// doubled the largest pages. So the payload carries `""` and the browser reads the DOM.
export class ArticleHtmlStore {
  private constructor() {}

  // Browser only, by page and revision: the first render's read, kept for a return visit
  // after Prose has rewired the DOM. A revision is immutable, so an entry never goes stale.
  private static readonly read = new Map<string, string>();

  // The dehydrated copy only: the server's own cache keeps the HTML its render needs.
  public static strip(state: DehydratedState): DehydratedState {
    return {
      ...state,
      queries: state.queries.map((query) =>
        ArticleHtmlStore.isReading(query.queryKey)
          ? { ...query, state: { ...query.state, data: ArticleHtmlStore.blank(query.state.data) } }
          : query,
      ),
    };
  }

  // Called during the first client render, before `Prose` adds its buttons and tabs.
  public static resolve(reading: DocReadingDto): DocReadingDto {
    const page = reading.page;
    if (page?.html !== "") return reading;
    const key = `${page.id}:${page.revisionNo}`;
    let html = ArticleHtmlStore.read.get(key);
    if (html === undefined && typeof document !== "undefined") {
      // The reader renders one article, so the one `.ui-prose` on the page is this one.
      html = document.querySelector(".ui-prose")?.innerHTML ?? "";
      if (html !== "") ArticleHtmlStore.read.set(key, html);
    }
    return { ...reading, page: { ...page, html: html ?? "" } };
  }

  // `/doc`'s `["doc", "read", …]` and `/docs`' `["docs", "read", …]`.
  private static isReading(key: readonly unknown[]): boolean {
    return (key[0] === "doc" || key[0] === "docs") && key[1] === "read";
  }

  // `/doc` caches the reading itself; `/docs` caches it inside `{ reading, cacheable }`.
  private static blank(data: unknown): unknown {
    if (typeof data !== "object" || data === null) return data;
    if ("reading" in data) {
      const holder = data as { reading: DocReadingDto | null };
      return holder.reading
        ? { ...holder, reading: ArticleHtmlStore.blankReading(holder.reading) }
        : data;
    }
    return "page" in data ? ArticleHtmlStore.blankReading(data as DocReadingDto) : data;
  }

  private static blankReading(reading: DocReadingDto): DocReadingDto {
    const page: Page | null = reading.page;
    return page ? { ...reading, page: { ...page, html: "" } } : reading;
  }
}
