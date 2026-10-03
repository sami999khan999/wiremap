import type {
  AddRepositoryInput,
  ApiClient,
  CreateProjectInput,
  ProjectDto,
  ProjectGrantDto,
  ProjectRefInput,
  RemoveRepositoryInput,
  RevokeProjectGrantInput,
  SaveProjectGrantInput,
  UpdateProjectInput,
  UpdateRepositoryInput,
} from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

// Every write invalidates the whole namespace and the session's capabilities ride on the
// next request, so a grant shows up without a reload.
export class ProjectMutations {
  private constructor() {}

  public static useCreate(client: ApiClient) {
    return useAppMutation<ProjectDto, CreateProjectInput>({
      mutationFn: (input) => client.project.create(input),
      invalidates: [QueryKeys.project.all()],
    });
  }

  public static useUpdate(client: ApiClient) {
    return useAppMutation<ProjectDto, UpdateProjectInput>({
      mutationFn: (input) => client.project.update(input),
      invalidates: [QueryKeys.project.all()],
    });
  }

  public static useRemove(client: ApiClient) {
    return useAppMutation<{ ok: true }, ProjectRefInput>({
      mutationFn: (input) => client.project.remove(input),
      invalidates: [QueryKeys.project.all()],
    });
  }

  public static useAddRepository(client: ApiClient) {
    return useAppMutation<ProjectDto, AddRepositoryInput>({
      mutationFn: (input) => client.project.addRepository(input),
      invalidates: [QueryKeys.project.all()],
    });
  }

  public static useUpdateRepository(client: ApiClient) {
    return useAppMutation<ProjectDto, UpdateRepositoryInput>({
      mutationFn: (input) => client.project.updateRepository(input),
      invalidates: [QueryKeys.project.all()],
    });
  }

  public static useRemoveRepository(client: ApiClient) {
    return useAppMutation<ProjectDto, RemoveRepositoryInput>({
      mutationFn: (input) => client.project.removeRepository(input),
      invalidates: [QueryKeys.project.all()],
    });
  }

  public static useSaveGrant(client: ApiClient) {
    return useAppMutation<ProjectGrantDto, SaveProjectGrantInput>({
      mutationFn: (input) => client.project.saveGrant(input),
      invalidates: [QueryKeys.project.all()],
    });
  }

  public static useRevokeGrant(client: ApiClient) {
    return useAppMutation<{ ok: true }, RevokeProjectGrantInput>({
      mutationFn: (input) => client.project.revokeGrant(input),
      invalidates: [QueryKeys.project.all()],
    });
  }
}
