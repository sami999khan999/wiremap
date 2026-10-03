import type { AiSettingsDto, ApiClient, UpdateAiSettingsInput } from "../import.js";
import { queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

export class AskQueries {
  private constructor() {}

  public static settings(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.ask.settings(),
      queryFn: () => client.ask.settings({}),
      staleTime: 60_000,
    });
  }

  public static available(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.ask.available(),
      queryFn: () => client.ask.available({}),
      staleTime: 5 * 60_000,
    });
  }
}

export class AskMutations {
  private constructor() {}

  public static useUpdate(client: ApiClient) {
    return useAppMutation<AiSettingsDto, UpdateAiSettingsInput>({
      mutationFn: (input) => client.ask.updateSettings(input),
      invalidates: [QueryKeys.ask.all()],
    });
  }

  public static useTest(client: ApiClient) {
    return useAppMutation<{ ok: boolean }, Record<string, never>>({
      mutationFn: () => client.ask.testKey({}),
      invalidates: [],
    });
  }
}
