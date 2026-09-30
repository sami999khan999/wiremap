import { type ApiClient, ERROR_CATALOG, ErrorNormalizer, QueryClient } from "../import.js";

export interface QueryClientOptions {
  // A constructed client, never a base URL. That is what lets the server hand this an
  // in-process transport and the browser an HTTP one, with nothing downstream differing.
  readonly transport: ApiClient;
  readonly staleTimeMs?: number;
}

export interface QueryRuntime {
  readonly queryClient: QueryClient;
  readonly apiClient: ApiClient;
}

// A factory, never a module-scope instance: one client shared across concurrent requests
// is a cross-tenant leak. See docs/reference/lifetime.md.
export function createQueryClient(options: QueryClientOptions): QueryRuntime {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: options.staleTimeMs ?? 30_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => {
          // Retryability is a fact about the code, declared once in the catalog: a retried
          // `FORBIDDEN` is a three-second wait for the same answer.
          const normalized = ErrorNormalizer.normalize(error);
          if (!ERROR_CATALOG[normalized.code].retryable) return false;
          return failureCount < 2;
        },
        // Every refetch is an authenticated round trip carrying a capability resolution,
        // so freshness is opt-in per query.
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });

  return { queryClient, apiClient: options.transport };
}
