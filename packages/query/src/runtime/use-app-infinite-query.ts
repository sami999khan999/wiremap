import {
  type InfiniteData,
  type QueryKey,
  type UseInfiniteQueryOptions,
  type UseInfiniteQueryResult,
  useInfiniteQuery,
} from "../import.js";

// A pass-through, exactly like `useAppQuery`, and the five type parameters are copied
// from the library's own signature: fewer collapses `data` to `unknown` at the call site.
export function useAppInfiniteQuery<
  TQueryFnData,
  TError,
  TData = InfiniteData<TQueryFnData>,
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = unknown,
>(
  options: UseInfiniteQueryOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>,
): UseInfiniteQueryResult<TData, TError> {
  return useInfiniteQuery(options);
}

export type { InfiniteData };
