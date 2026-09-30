import type {
  ApiClient,
  CreateDocPageInput,
  CreateDocSpaceInput,
  DocGrantDto,
  DocImageType,
  DocPageDraftDto,
  DocPageRefInput,
  DocSpaceDto,
  DocSpaceId,
  DocSpaceRefInput,
  MoveDocPageInput,
  PreviewDocPageInput,
  PublishDocPageInput,
  RenderedDocDto,
  RestoreDocRevisionInput,
  RevokeDocGrantInput,
  SaveDocGrantInput,
  SaveDocPageInput,
  UpdateDocSpaceInput,
} from "../import.js";
import { useQueryClient } from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

// What each write can change, declared once. A structural change — a move, a delete, a
// publish — changes every reader's sidebar, so it takes the readings with it.
export class DocMutations {
  private constructor() {}

  public static useCreateSpace(client: ApiClient) {
    return useAppMutation<DocSpaceDto, CreateDocSpaceInput>({
      mutationFn: (input) => client.docSpace.create(input),
      invalidates: [QueryKeys.doc.spaces()],
    });
  }

  public static useUpdateSpace(client: ApiClient) {
    return useAppMutation<DocSpaceDto, UpdateDocSpaceInput>({
      mutationFn: (input) => client.docSpace.update(input),
      invalidates: [QueryKeys.doc.all()],
    });
  }

  public static useDeleteSpace(client: ApiClient) {
    return useAppMutation<{ ok: true }, DocSpaceRefInput>({
      mutationFn: (input) => client.docSpace.remove(input),
      invalidates: [QueryKeys.doc.all()],
    });
  }

  public static useCreatePage(client: ApiClient) {
    return useAppMutation<DocPageDraftDto, CreateDocPageInput>({
      mutationFn: (input) => client.docPage.create(input),
      invalidates: [QueryKeys.doc.trees(), QueryKeys.doc.readings()],
    });
  }

  // The answer is the new draft, written straight into the cache: refetching what the
  // server just returned would race the author's next keystroke.
  public static useSavePage(client: ApiClient) {
    const queryClient = useQueryClient();
    return useAppMutation<DocPageDraftDto, SaveDocPageInput>({
      mutationFn: (input) => client.docPage.save(input),
      invalidates: [QueryKeys.doc.trees(), QueryKeys.doc.readings()],
      onSuccess: (draft) => {
        queryClient.setQueryData(QueryKeys.doc.page(draft.id), draft);
      },
    });
  }

  public static usePublishPage(client: ApiClient) {
    const queryClient = useQueryClient();
    return useAppMutation<DocPageDraftDto, PublishDocPageInput>({
      mutationFn: (input) => client.docPage.publish(input),
      invalidates: [QueryKeys.doc.trees(), QueryKeys.doc.readings()],
      onSuccess: async (draft) => {
        queryClient.setQueryData(QueryKeys.doc.page(draft.id), draft);
        await queryClient.invalidateQueries({ queryKey: QueryKeys.doc.revisions(draft.id) });
      },
    });
  }

  public static useMovePage(client: ApiClient) {
    return useAppMutation<{ ok: true }, MoveDocPageInput>({
      mutationFn: (input) => client.docPage.move(input),
      invalidates: [QueryKeys.doc.trees(), QueryKeys.doc.readings()],
    });
  }

  public static useDeletePage(client: ApiClient) {
    return useAppMutation<{ ok: true }, DocPageRefInput>({
      mutationFn: (input) => client.docPage.remove(input),
      invalidates: [QueryKeys.doc.trees(), QueryKeys.doc.readings()],
    });
  }

  // A POST, not a query: the input is the whole unsaved text, and caching one entry per
  // keystroke's worth of Markdown would be a leak with a key.
  public static usePreview(client: ApiClient) {
    return useAppMutation<RenderedDocDto, PreviewDocPageInput>({
      mutationFn: (input) => client.docPage.preview(input),
    });
  }

  // Two steps as one mutation: sign, then PUT the bytes straight to storage. The answer is
  // the URL the Markdown links, which goes through the app's access check, not the bucket.
  public static useUploadImage(client: ApiClient) {
    return useAppMutation<string, { readonly spaceId: DocSpaceId; readonly file: File }>({
      mutationFn: async ({ spaceId, file }) => {
        const signed = await client.docPage.upload({
          spaceId,
          contentType: file.type as DocImageType,
          size: file.size,
        });
        const response = await fetch(signed.uploadUrl, {
          method: "PUT",
          headers: { "content-type": file.type },
          body: file,
        });
        // The code the server would have used, so the copy layer has a sentence for it.
        if (!response.ok) throw new Error("UNAVAILABLE");
        return signed.url;
      },
    });
  }

  public static useSaveGrant(client: ApiClient) {
    return useAppMutation<DocGrantDto, SaveDocGrantInput>({
      mutationFn: (input) => client.docGrant.save(input),
      invalidates: [QueryKeys.doc.allGrants()],
    });
  }

  public static useRevokeGrant(client: ApiClient) {
    return useAppMutation<{ ok: true }, RevokeDocGrantInput>({
      mutationFn: (input) => client.docGrant.revoke(input),
      invalidates: [QueryKeys.doc.allGrants()],
    });
  }

  public static useRestoreRevision(client: ApiClient) {
    const queryClient = useQueryClient();
    return useAppMutation<DocPageDraftDto, RestoreDocRevisionInput>({
      mutationFn: (input) => client.docPage.restore(input),
      invalidates: [QueryKeys.doc.trees()],
      onSuccess: (draft) => {
        queryClient.setQueryData(QueryKeys.doc.page(draft.id), draft);
      },
    });
  }
}
