import type { ApiClient, CommentDto, CommentId, CreateCommentInput, ProjectId } from "../import.js";
import { queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

interface CommentRef {
  readonly projectId: ProjectId;
  readonly commentId: CommentId;
}

export class CommentQueries {
  private constructor() {}

  public static list(client: ApiClient, projectId: ProjectId) {
    return queryOptions({
      queryKey: QueryKeys.comment.list(projectId),
      queryFn: (): Promise<readonly CommentDto[]> =>
        client.comment.list({ projectId, target: null }),
      staleTime: 30_000,
    });
  }
}

export class CommentMutations {
  private constructor() {}

  public static useCreate(client: ApiClient) {
    return useAppMutation<CommentDto, CreateCommentInput>({
      mutationFn: (input) => client.comment.create(input),
      invalidates: [QueryKeys.comment.all()],
    });
  }

  public static useUpdate(client: ApiClient) {
    return useAppMutation<CommentDto, CommentRef & { readonly body: string }>({
      mutationFn: (input) => client.comment.update(input),
      invalidates: [QueryKeys.comment.all()],
    });
  }

  public static useRemove(client: ApiClient) {
    return useAppMutation<{ ok: true }, CommentRef>({
      mutationFn: (input) => client.comment.remove(input),
      invalidates: [QueryKeys.comment.all()],
    });
  }

  public static useResolve(client: ApiClient) {
    return useAppMutation<CommentDto, CommentRef & { readonly on: boolean }>({
      mutationFn: (input) => client.comment.resolve(input),
      invalidates: [QueryKeys.comment.all()],
    });
  }

  public static usePin(client: ApiClient) {
    return useAppMutation<CommentDto, CommentRef & { readonly on: boolean }>({
      mutationFn: (input) => client.comment.pin(input),
      invalidates: [QueryKeys.comment.all()],
    });
  }
}
