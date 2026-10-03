import type { TeamId, UserId } from "@loadbearing/contracts";
import { ConflictError, ForbiddenError, NotFoundError } from "@loadbearing/errors";
import { describe, expect, it } from "vitest";
import type { MemberRecord, MemberRepository } from "../../src/member/member.repository.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { AddTeamMemberUseCase } from "../../src/team/add-team-member.use-case.js";
import { CreateTeamUseCase } from "../../src/team/create-team.use-case.js";
import { type TeamRecord, TeamRepository } from "../../src/team/team.repository.js";
import {
  DirectUnitOfWork,
  holding,
  OTHER,
  RecordingActivity,
  RecordingInvalidator,
} from "../support/wiremap-fakes.js";

class MemoryTeams extends TeamRepository {
  public readonly teams: TeamRecord[] = [];
  public readonly placed: { teamId: TeamId; userId: UserId }[] = [];
  public list() {
    return Promise.resolve({ items: this.teams, total: this.teams.length });
  }
  public findById(_org: unknown, id: TeamId) {
    return Promise.resolve(this.teams.find((team) => team.id === id) ?? null);
  }
  public existsByName(_org: unknown, name: string, exceptId?: TeamId) {
    return Promise.resolve(
      this.teams.some(
        (team) => team.name.toLowerCase() === name.toLowerCase() && team.id !== exceptId,
      ),
    );
  }
  public members() {
    return Promise.resolve([]);
  }
  public save(_org: unknown, team: { id: TeamId; name: string; description: string | null }) {
    this.teams.push({ ...team, memberCount: 0, createdAt: new Date() });
    return Promise.resolve();
  }
  public delete() {
    return Promise.resolve();
  }
  public addMember(_org: unknown, teamId: TeamId, userId: UserId) {
    this.placed.push({ teamId, userId });
    return Promise.resolve();
  }
  public removeMember() {
    return Promise.resolve();
  }
}

const MANAGER = holding("member.team.manage", "member.read");

describe("CreateTeamUseCase", () => {
  it("creates a team and refuses a second with the same name in any case", async () => {
    const teams = new MemoryTeams();
    const useCase = new CreateTeamUseCase(
      new Authorizer(),
      teams,
      new RecordingActivity(),
      new DirectUnitOfWork(),
    );

    const team = await useCase.execute(MANAGER, { name: "Backend", description: null });
    expect(team.name).toBe("Backend");

    await expect(
      useCase.execute(MANAGER, { name: "backend", description: null }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses a principal without member.team.manage", async () => {
    const useCase = new CreateTeamUseCase(
      new Authorizer(),
      new MemoryTeams(),
      new RecordingActivity(),
      new DirectUnitOfWork(),
    );

    await expect(
      useCase.execute(holding("member.read"), { name: "x", description: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("AddTeamMemberUseCase", () => {
  const members = (row: Partial<MemberRecord> | null) =>
    ({
      findByUser: () =>
        Promise.resolve(
          row ? ({ userId: OTHER, deactivated: false, ...row } as MemberRecord) : null,
        ),
    }) as unknown as MemberRepository;

  it("places an active member and drops their cached capabilities", async () => {
    const teams = new MemoryTeams();
    const team = await new CreateTeamUseCase(
      new Authorizer(),
      teams,
      new RecordingActivity(),
      new DirectUnitOfWork(),
    ).execute(MANAGER, { name: "Web", description: null });
    const invalidator = new RecordingInvalidator();
    const useCase = new AddTeamMemberUseCase(
      new Authorizer(),
      teams,
      members({}),
      invalidator,
      new RecordingActivity(),
      new DirectUnitOfWork(),
    );

    await useCase.execute(MANAGER, { teamId: team.id, userId: OTHER });

    expect(teams.placed).toEqual([{ teamId: team.id, userId: OTHER }]);
    expect(invalidator.users).toEqual([OTHER]);
  });

  it("refuses a stranger and a deactivated member", async () => {
    const teams = new MemoryTeams();
    const team = await new CreateTeamUseCase(
      new Authorizer(),
      teams,
      new RecordingActivity(),
      new DirectUnitOfWork(),
    ).execute(MANAGER, { name: "Web", description: null });
    const build = (row: Partial<MemberRecord> | null) =>
      new AddTeamMemberUseCase(
        new Authorizer(),
        teams,
        members(row),
        new RecordingInvalidator(),
        new RecordingActivity(),
        new DirectUnitOfWork(),
      );

    await expect(
      build(null).execute(MANAGER, { teamId: team.id, userId: OTHER }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      build({ deactivated: true }).execute(MANAGER, { teamId: team.id, userId: OTHER }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
