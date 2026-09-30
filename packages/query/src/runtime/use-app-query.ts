import { type QueryKey, type UseQueryOptions, type UseQueryResult, useQuery } from "../import.js";

// A pass-through so `feature` can read through a defined query without naming the cache
// library. A defaulted parameter here would break inference — hence nothing else.
export function useAppQuery<TQueryFnData, TError, TData, TQueryKey extends QueryKey>(
  options: UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
): UseQueryResult<TData, TError> {
  return useQuery(options);
}
