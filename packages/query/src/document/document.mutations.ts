import type {
  ApiClient,
  DocumentHitDto,
  IndexDocumentContractInput,
  QueuedDocumentDto,
  SearchDocumentsContractInput,
} from "../import.js";
import { useAppMutation } from "../runtime/index.js";

// Both are mutations, and search is the interesting one: it is a read, but it is a
// *body* request that records an activity row, so it has no cache entry to key.
export class DocumentMutations {
  private constructor() {}

  // Nothing to invalidate: indexing is queued, so no read this app performs changes
  // until the worker has run. A list that showed the document would be lying.
  public static useIndex(client: ApiClient) {
    return useAppMutation<QueuedDocumentDto, IndexDocumentContractInput>({
      mutationFn: (input) => client.document.index(input),
      invalidates: [],
    });
  }

  public static useSearch(client: ApiClient) {
    return useAppMutation<{ hits: readonly DocumentHitDto[] }, SearchDocumentsContractInput>({
      mutationFn: (input) => client.document.search(input),
      invalidates: [],
    });
  }
}
