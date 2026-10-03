import type {
  ApiClient,
  CreateTeamInput,
  TeamDto,
  TeamMembershipInput,
  TeamRefInput,
  UpdateTeamInput,
} from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

// Every write invalidates the whole namespace: a team's member count is on the list and
// its members are under their own key, and both move together.
export class TeamMutations {
  private constructor() {}

  public static useCreate(client: ApiClient) {
    return useAppMutation<TeamDto, CreateTeamInput>({
      mutationFn: (input) => client.team.create(input),
      invalidates: [QueryKeys.team.all()],
    });
  }

  public static useUpdate(client: ApiClient) {
    return useAppMutation<TeamDto, UpdateTeamInput>({
      mutationFn: (input) => client.team.update(input),
      invalidates: [QueryKeys.team.all()],
    });
  }

  public static useRemove(client: ApiClient) {
    return useAppMutation<{ ok: true }, TeamRefInput>({
      mutationFn: (input) => client.team.remove(input),
      invalidates: [QueryKeys.team.all()],
    });
  }

  public static useAddMember(client: ApiClient) {
    return useAppMutation<{ ok: true }, TeamMembershipInput>({
      mutationFn: (input) => client.team.addMember(input),
      invalidates: [QueryKeys.team.all()],
    });
  }

  public static useRemoveMember(client: ApiClient) {
    return useAppMutation<{ ok: true }, TeamMembershipInput>({
      mutationFn: (input) => client.team.removeMember(input),
      invalidates: [QueryKeys.team.all()],
    });
  }
}
