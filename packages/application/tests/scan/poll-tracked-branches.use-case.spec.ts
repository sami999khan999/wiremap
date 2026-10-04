import type { OrganizationId, ProjectId, RepositoryId } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import { PollTrackedBranchesUseCase } from "../../src/scan/poll-tracked-branches.use-case.js";

const ORG = "018f8c00-0000-7000-8000-0000000000a0" as OrganizationId;
const P1 = "018f8c00-0000-7000-8000-0000000000c1" as ProjectId;
const P2 = "018f8c00-0000-7000-8000-0000000000c2" as ProjectId;

const repo = (projectId: ProjectId, installationId: number, name: string, branches = ["main"]) => ({
  organizationId: ORG,
  projectId,
  repositoryId: `${name}-id` as RepositoryId,
  installationId,
  fullName: `acme/${name}`,
  branches,
});

class MemoryCache {
  public readonly values = new Map<string, unknown>();
  public get<T>(key: string) {
    return Promise.resolve((this.values.get(key) as T | undefined) ?? null);
  }
  public set(key: string, value: unknown) {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

const setup = (
  repositories: ReturnType<typeof repo>[],
  heads: Record<string, string | Error>,
  options: { enabled?: boolean; configured?: boolean } = {},
) => {
  const cache = new MemoryCache();
  const calls: string[] = [];
  const provider = {
    isConfigured: () => Promise.resolve(options.configured ?? true),
    branchHead: (_installation: number, fullName: string, branch: string) => {
      calls.push(`${fullName}@${branch}`);
      const head = heads[`${fullName}@${branch}`];
      return head instanceof Error ? Promise.reject(head) : Promise.resolve(head ?? null);
    },
  };
  const useCase = new PollTrackedBranchesUseCase(
    { polledRepositories: () => Promise.resolve(repositories) } as never,
    provider as never,
    cache as never,
    options.enabled ?? true,
  );
  return { cache, calls, heads, useCase };
};

describe("PollTrackedBranchesUseCase", () => {
  it("records heads on the first tick and scans none, then scans what moved", async () => {
    const { heads, useCase } = setup([repo(P1, 1, "api"), repo(P2, 1, "web")], {
      "acme/api@main": "a".repeat(40),
      "acme/web@main": "b".repeat(40),
    });

    expect(await useCase.due()).toEqual([]);
    heads["acme/api@main"] = "c".repeat(40);
    expect(await useCase.due()).toEqual([{ organizationId: ORG, projectId: P1, branch: "main" }]);
    expect(await useCase.due()).toEqual([]);
  });

  it("skips an installation whose webhooks arrive, and polls the others", async () => {
    const { cache, calls, useCase } = setup([repo(P1, 1, "api"), repo(P2, 2, "web")], {
      "acme/api@main": "a".repeat(40),
      "acme/web@main": "b".repeat(40),
    });
    await useCase.webhookSeen(1);

    await useCase.due();
    expect(calls).toEqual(["acme/web@main"]);
  });

  it("keeps polling past a repository that fails", async () => {
    const { calls, useCase } = setup([repo(P1, 1, "gone"), repo(P2, 1, "web")], {
      "acme/gone@main": new Error("404"),
      "acme/web@main": "b".repeat(40),
    });

    await expect(useCase.due()).resolves.toEqual([]);
    expect(calls).toEqual(["acme/gone@main", "acme/web@main"]);
  });

  it("does nothing when switched off or when no App is configured", async () => {
    const heads = { "acme/api@main": "a".repeat(40) };
    const off = setup([repo(P1, 1, "api")], heads, { enabled: false });
    const noApp = setup([repo(P1, 1, "api")], heads, { configured: false });

    expect(await off.useCase.due()).toEqual([]);
    expect(await noApp.useCase.due()).toEqual([]);
    expect([...off.calls, ...noApp.calls]).toEqual([]);
  });
});
