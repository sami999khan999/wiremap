import { type UseMutationOptions, useMutation, useQueryClient } from "../import.js";

// One optimistic edit, against one key. Declared rather than written by hand at each call
// site: cancel, snapshot and roll back is four steps and three of them are forgettable.
export interface OptimisticEdit<TVariables, TCache> {
  readonly queryKey: readonly unknown[];
  // Returning `cached` unchanged is how "this mutation changes nothing visible here"
  // is said. Never mutate the argument — the snapshot is the same object.
  readonly apply: (cached: TCache, variables: TVariables) => TCache;
}

// What `onMutate` hands `onError`, exported because it lands in the inferred return type
// of every hook. `previous` is undefined when the list is simply not on screen.
export interface Rollback<TCache> {
  readonly queryKey: readonly unknown[];
  readonly previous: TCache | undefined;
}

export interface AppMutationOptions<TData, TVariables, TCache = never>
  extends Omit<
    UseMutationOptions<TData, Error, TVariables, Rollback<TCache> | undefined>,
    "onMutate" | "onSuccess"
  > {
  // Keys invalidated after a successful mutation. Declared, never imperative — so
  // "what does reactivating a task affect" has one answer in one place.
  readonly invalidates?: readonly (readonly unknown[])[];
  // Invalidated too, whether or not `invalidates` names it: an edit the server never
  // confirmed would otherwise stay on screen until something else refetched.
  readonly optimistic?: OptimisticEdit<TVariables, TCache>;
  readonly onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
}

export function useAppMutation<TData, TVariables, TCache = never>(
  options: AppMutationOptions<TData, TVariables, TCache>,
) {
  const queryClient = useQueryClient();
  const optimistic = options.optimistic;

  return useMutation<TData, Error, TVariables, Rollback<TCache> | undefined>({
    ...options,

    onMutate: async (variables) => {
      if (!optimistic) return undefined;
      const queryKey = [...optimistic.queryKey];

      // Cancelled before the write, not after: a refetch already in flight resolves with
      // the server's pre-mutation answer and puts the row back that the user removed.
      await queryClient.cancelQueries({ queryKey });

      const previous = queryClient.getQueryData<TCache>(queryKey);
      if (previous !== undefined) {
        queryClient.setQueryData<TCache>(queryKey, optimistic.apply(previous, variables));
      }

      return { queryKey, previous };
    },

    onError: (error, variables, context, mutation) => {
      // Restored before the caller's handler runs, which may render the failure beside
      // the row that has to be back on screen for the message to mean anything.
      if (context && context.previous !== undefined) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
      options.onError?.(error, variables, context, mutation);
    },

    onSuccess: async (data, variables) => {
      const keys = [...(options.invalidates ?? [])];
      if (optimistic && !keys.some((key) => sameKey(key, optimistic.queryKey))) {
        keys.push(optimistic.queryKey);
      }

      // Invalidations first, then the caller's hook. A caller that navigates on success
      // should not race the refetch of the screen it is leaving.
      await Promise.all(
        keys.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })),
      );
      await options.onSuccess?.(data, variables);
    },
  });
}

// Shallow, because a query key is a tuple of primitives and one params object — and the
// object is the same reference on both sides when it came from the same `QueryKeys` call.
function sameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((part, index) => Object.is(part, b[index]));
}
