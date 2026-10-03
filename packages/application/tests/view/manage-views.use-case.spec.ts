import type { GraphViewId, OrganizationId, ProjectId } from "@loadbearing/contracts";
import { ForbiddenError, NotFoundError } from "@loadbearing/errors";
import { CapabilitySet } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";
import { type GraphViewRecord, GraphViewRepository } from "../../src/view/graph-view.repository.js";
import { ManageViewsUseCase } from "../../src/view/manage-views.use-case.js";
import { ACTOR, ORG, OTHER } from "../support/wiremap-fakes.js";

const PROJECT = "018f8c00-0000-7000-8000-0000000000c1" as ProjectId;

class MemoryViews extends GraphViewRepository {
  public readonly rows: GraphViewRecord[] = [];
  public list() {
    return Promise.resolve(this.rows);
  }
  public findById(_org: OrganizationId, id: GraphViewId) {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }
  public save(_org: OrganizationId, view: Omit<GraphViewRecord, "createdAt">) {
    this.rows.push({ ...view, createdAt: new Date() });
    return Promise.resolve();
  }
  public remove(_org: OrganizationId, id: GraphViewId) {
    this.rows.splice(
      this.rows.findIndex((row) => row.id === id),
      1,
    );
    return Promise.resolve();
  }
  public removeForProject() {
    return Promise.resolve();
  }
}

const reader = (userId = ACTOR, extra: string[] = []) =>
  new Principal(
    ORG,
    userId,
    CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: { [PROJECT]: { grants: ["project.graph.read", ...extra] as never, denies: [] } },
    }),
  );

const projects = { findById: () => Promise.resolve({ id: PROJECT }) } as never;

describe("ManageViewsUseCase", () => {
  it("saves only the query string, and lets the author or a project admin remove it", async () => {
    const views = new MemoryViews();
    const useCase = new ManageViewsUseCase(new Authorizer(), projects, views);

    const saved = await useCase.save(reader(), {
      projectId: PROJECT,
      name: " Users ",
      state: "?open=src/users#frag ignored",
    });
    expect(saved).toMatchObject({ name: "Users", state: "open=src/users" });

    await expect(
      useCase.remove(reader(OTHER), { projectId: PROJECT, viewId: saved.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await useCase.remove(reader(OTHER, ["project.settings.manage"]), {
      projectId: PROJECT,
      viewId: saved.id,
    });
    expect(views.rows).toEqual([]);
    await expect(
      useCase.remove(reader(), { projectId: PROJECT, viewId: saved.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
