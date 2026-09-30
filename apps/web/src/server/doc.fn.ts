import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { type DocReadingDto, type DocSearchHitDto, type DocSpaceDto, z } from "~/import.js";
import { container } from "./container.js";

// A request with no cookie and no credential renders the same HTML for everyone, so a
// shared cache may keep it. Anything else may carry a session, a locale or a palette.
const cacheable = (headers: Headers): boolean =>
  !headers.has("cookie") && !headers.has("authorization") && !headers.has("x-api-key");

// The same `.min(1)` bound the contract gives a slug, restated: this is a URL a browser
// sent, validated at the door before anything is placed.
const READ = z.object({
  space: z.string().min(1).max(60),
  path: z.string().max(500).default(""),
});

export interface PlatformDocReading {
  // Null is "no such page, or not yours": the two are one answer, so a private slug
  // cannot be found by asking for it.
  readonly reading: DocReadingDto | null;
  readonly cacheable: boolean;
}

// The same bounds as `DocPageContract.search`, restated at the door for the same reason.
const SEARCH = z.object({
  query: z.string().trim().min(2).max(200),
  limit: z.number().int().positive().max(20).default(10),
});

// Per client address, since an anonymous search has no principal to count against. The
// oRPC limit on `docPage.search` covers signed-in callers the same way.
const SEARCH_LIMIT = 60;
const SEARCH_WINDOW_SECONDS = 60;

// The first hop the proxy recorded. Spoofable without one, which costs a caller only
// their own share of the limit.
const clientOf = (headers: Headers): string =>
  headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "direct";

export interface PlatformDocSpaces {
  readonly spaces: readonly DocSpaceDto[];
  readonly cacheable: boolean;
}

// The platform's docs, signed in or not, placed at the platform organization's node. See
// docs/reference/server-functions.md.
export const fetchPlatformDocReading = createServerFn({ method: "GET" })
  .validator(READ)
  .handler(async ({ data }): Promise<PlatformDocReading> => {
    const { headers } = getRequest();
    const viewer = await container.principals.fromHeaders(headers);
    const platform = await container.platform.organizationId();

    try {
      const reading = await container.placedAt(
        platform,
        () => container.doc.readPlatform.execute(viewer, data),
        { replica: true },
      );
      return { reading, cacheable: cacheable(headers) };
    } catch (error) {
      if (error instanceof Error && error.message === "NOT_FOUND") {
        return { reading: null, cacheable: cacheable(headers) };
      }
      throw error;
    }
  });

export const fetchPlatformDocSpaces = createServerFn({ method: "GET" }).handler(
  async (): Promise<PlatformDocSpaces> => {
    const { headers } = getRequest();
    const viewer = await container.principals.fromHeaders(headers);
    const platform = await container.platform.organizationId();
    const { items } = await container.placedAt(
      platform,
      () => container.doc.listPlatformSpaces.execute(viewer),
      { replica: true },
    );
    return { spaces: items, cacheable: cacheable(headers) };
  },
);

// Over the spaces this viewer may read and nothing else. Past the limit it answers with
// nothing, which the palette shows as no results rather than as an error.
export const searchPlatformDocs = createServerFn({ method: "GET" })
  .validator(SEARCH)
  .handler(async ({ data }): Promise<readonly DocSearchHitDto[]> => {
    const { headers } = getRequest();
    const count = await container.rateLimits
      .hit(`doc-search:${clientOf(headers)}`, SEARCH_WINDOW_SECONDS)
      .catch(() => 0);
    if (count > SEARCH_LIMIT) return [];

    const viewer = await container.principals.fromHeaders(headers);
    const platform = await container.platform.organizationId();
    const { items } = await container.placedAt(
      platform,
      () => container.doc.searchPlatform.execute(viewer, data),
      { replica: true },
    );
    return items;
  });
