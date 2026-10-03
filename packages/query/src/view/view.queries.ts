import type {
  ApiClient,
  GraphViewDto,
  ProjectId,
  RemoveViewInput,
  SaveViewInput,
} from "../import.js";
import { queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

export class ViewQueries {
  private constructor() {}

  public static list(client: ApiClient, projectId: ProjectId) {
    return queryOptions({
      queryKey: QueryKeys.view.list(projectId),
      queryFn: () => client.view.list({ projectId }),
      staleTime: 60_000,
    });
  }
}

export class ViewMutations {
  private constructor() {}

  public static useSave(client: ApiClient) {
    return useAppMutation<GraphViewDto, SaveViewInput>({
      mutationFn: (input) => client.view.save(input),
      invalidates: [QueryKeys.view.all()],
    });
  }

  public static useRemove(client: ApiClient) {
    return useAppMutation<{ ok: true }, RemoveViewInput>({
      mutationFn: (input) => client.view.remove(input),
      invalidates: [QueryKeys.view.all()],
    });
  }
}
