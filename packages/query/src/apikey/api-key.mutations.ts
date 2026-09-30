import type {
  ApiClient,
  ApiKeyDto,
  CreateApiKeyInput,
  CreatedApiKeyDto,
  RevokeApiKeyInput,
} from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

export class ApiKeyMutations {
  private constructor() {}

  // The plaintext is in `data.token` and nowhere else. It is deliberately not written
  // into the cache: `invalidates` refetches the list, which never carries it.
  public static useCreate(client: ApiClient) {
    return useAppMutation<CreatedApiKeyDto, CreateApiKeyInput>({
      mutationFn: (input) => client.apiKey.create(input),
      invalidates: [QueryKeys.apiKey.all()],
    });
  }

  public static useRevoke(client: ApiClient) {
    return useAppMutation<ApiKeyDto, RevokeApiKeyInput>({
      mutationFn: (input) => client.apiKey.revoke(input),
      invalidates: [QueryKeys.apiKey.all()],
    });
  }
}
