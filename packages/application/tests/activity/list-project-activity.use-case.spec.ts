import type { ProjectId } from "@loadbearing/contracts";
import { NotFoundError } from "@loadbearing/errors";
import { describe, expect, it } from "vitest";
import type { ActivityQuery } from "../../src/activity/activity.reader.js";
import { ListProjectActivityUseCase } from "../../src/activity/list-project-activity.use-case.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { ACTOR, holding } from "../support/wiremap-fakes.js";

const PROJECT = "018f8c00-0000-7000-8000-0000000000c1" as ProjectId;

const setup = () => {
  const queries: ActivityQuery[] = [];
  const useCase = new ListProjectActivityUseCase(
    new Authorizer(),
    { findById: () => Promise.resolve({ id: PROJECT, visibility: "org" }) } as never,
    {
      list: (_org: unknown, query: ActivityQuery) => {
        queries.push(query);
        return Promise.resolve({
          items: [
            {
              id: "row",
              action: "comment.created",
              actorId: ACTOR,
              actorName: null,
              payload: { projectId: PROJECT },
              occurredAt: new Date(),
            },
          ],
          nextCursor: null,
        });
      },
    } as never,
    { namesOf: () => Promise.resolve(new Map([[ACTOR, "Ada"]])) } as never,
  );
  return { queries, useCase };
};

describe("ListProjectActivityUseCase", () => {
  it("reads the trail filtered to the project, with actor names", async () => {
    const { queries, useCase } = setup();
    const page = await useCase.execute(holding("project.graph.read"), {
      projectId: PROJECT,
      limit: 20,
    });
    expect(queries[0]).toEqual({ projectId: PROJECT, limit: 20 });
    expect(page.items[0]?.actorName).toBe("Ada");
  });

  // The feed is the project's: someone who cannot read it is told it does not exist.
  it("answers NOT_FOUND to someone who cannot read the project", async () => {
    const { queries, useCase } = setup();
    await expect(
      useCase.execute(holding(), { projectId: PROJECT, limit: 20 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(queries).toEqual([]);
  });
});
