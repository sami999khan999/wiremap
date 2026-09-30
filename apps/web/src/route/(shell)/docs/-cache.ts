// The response headers for a public docs page. Shared only when the request carried no
// cookie and no credential — the HTML is otherwise someone's, with their session in it.
export class DocCacheHeaders {
  private constructor() {}

  // A minute fresh, then served stale for a day while one request refreshes it. Every
  // header the render reads is named in `Vary`, so a shared cache cannot mix two readers.
  public static of(cacheable: boolean | undefined): Record<string, string> {
    return cacheable
      ? {
          "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=86400",
          Vary: "Cookie, Accept-Language, Sec-CH-Prefers-Color-Scheme",
        }
      : { "Cache-Control": "private, no-store" };
  }
}
