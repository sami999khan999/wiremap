import type {
  ApiClient,
  CreatedWebhookDto,
  CreateWebhookInput,
  UpdateWebhookInput,
  WebhookDto,
  WebhookId,
} from "../import.js";
import { queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

export class WebhookQueries {
  private constructor() {}

  public static list(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.webhook.list(),
      queryFn: (): Promise<readonly WebhookDto[]> => client.webhook.list(),
      staleTime: 30_000,
    });
  }
}

export class WebhookMutations {
  private constructor() {}

  public static useCreate(client: ApiClient) {
    return useAppMutation<CreatedWebhookDto, CreateWebhookInput>({
      mutationFn: (input) => client.webhook.create(input),
      invalidates: [QueryKeys.webhook.all()],
    });
  }

  public static useUpdate(client: ApiClient) {
    return useAppMutation<WebhookDto, UpdateWebhookInput>({
      mutationFn: (input) => client.webhook.update(input),
      invalidates: [QueryKeys.webhook.all()],
    });
  }

  public static useRemove(client: ApiClient) {
    return useAppMutation<{ ok: true }, { readonly webhookId: WebhookId }>({
      mutationFn: (input) => client.webhook.remove(input),
      invalidates: [QueryKeys.webhook.all()],
    });
  }

  // A test changes nothing stored, so it invalidates nothing.
  public static useTest(client: ApiClient) {
    return useAppMutation<
      { readonly ok: boolean; readonly status: number | null },
      { readonly webhookId: WebhookId }
    >({
      mutationFn: (input) => client.webhook.test(input),
      invalidates: [],
    });
  }
}
