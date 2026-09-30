import type {
  ApiClient,
  DocGrantListDto,
  DocPageDraftDto,
  DocPageId,
  DocPageTreeDto,
  DocReadingDto,
  DocRevisionDto,
  DocRevisionListDto,
  DocSpaceDto,
  DocSpaceId,
  DocSpaceListDto,
} from "../import.js";
import { queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";

export class DocQueries {
  private constructor() {}

  public static spaces(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.doc.spaces(),
      queryFn: (): Promise<DocSpaceListDto> => client.docSpace.list({}),
      staleTime: 60_000,
    });
  }

  // Thirty seconds on top of the server's own cache. A publish invalidates it on this tab;
  // everyone else sees it within the window.
  public static reading(client: ApiClient, space: string, path: string) {
    return queryOptions({
      queryKey: QueryKeys.doc.reading(space, path),
      queryFn: (): Promise<DocReadingDto> => client.docPage.read({ space, path }),
      staleTime: 30_000,
    });
  }

  public static space(client: ApiClient, spaceId: DocSpaceId) {
    return queryOptions({
      queryKey: QueryKeys.doc.space(spaceId),
      queryFn: (): Promise<DocSpaceDto> => client.docSpace.get({ spaceId }),
      staleTime: 60_000,
    });
  }

  // The editor's views are always fresh: two authors in one space is the case they exist for.
  public static tree(client: ApiClient, spaceId: DocSpaceId) {
    return queryOptions({
      queryKey: QueryKeys.doc.tree(spaceId),
      queryFn: (): Promise<DocPageTreeDto> => client.docPage.tree({ spaceId }),
      staleTime: 0,
    });
  }

  public static page(client: ApiClient, pageId: DocPageId) {
    return queryOptions({
      queryKey: QueryKeys.doc.page(pageId),
      queryFn: (): Promise<DocPageDraftDto> => client.docPage.get({ pageId }),
      staleTime: 0,
    });
  }

  public static revisions(client: ApiClient, pageId: DocPageId) {
    return queryOptions({
      queryKey: QueryKeys.doc.revisions(pageId),
      queryFn: (): Promise<DocRevisionListDto> => client.docPage.revisions({ pageId }),
      staleTime: 0,
    });
  }

  // Always fresh: an operator is looking at who can read a private space right now.
  public static grants(client: ApiClient, spaceId: DocSpaceId) {
    return queryOptions({
      queryKey: QueryKeys.doc.grants(spaceId),
      queryFn: (): Promise<DocGrantListDto> => client.docGrant.list({ spaceId }),
      staleTime: 0,
    });
  }

  // A revision never changes once written, so it is never refetched.
  public static revision(client: ApiClient, pageId: DocPageId, revisionNo: number) {
    return queryOptions({
      queryKey: QueryKeys.doc.revision(pageId, revisionNo),
      queryFn: (): Promise<DocRevisionDto> => client.docPage.revision({ pageId, revisionNo }),
      staleTime: Number.POSITIVE_INFINITY,
    });
  }
}
