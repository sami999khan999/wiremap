import type { ProjectId, ScanId } from "@loadbearing/contracts";
import { NotFoundError } from "@loadbearing/errors";
import { describe, expect, it } from "vitest";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { QueryGraphUseCase } from "../../src/scan/query-graph.use-case.js";
import { GRAPH_DOC } from "../support/graph-document.js";
import { holding } from "../support/wiremap-fakes.js";

const PROJECT = "018f8c00-0000-7000-8000-0000000000c1" as ProjectId;
const SCAN = "018f8c00-0000-7000-8000-0000000000e1" as ScanId;
const OTHER_SCAN = "018f8c00-0000-7000-8000-0000000000e2" as ScanId;

const setup = () => {
  let reads = 0;
  const scan = { id: SCAN, projectId: PROJECT, state: "succeeded", graphKey: "k" };
  const useCase = new QueryGraphUseCase(
    new Authorizer(),
    { findById: () => Promise.resolve({ id: PROJECT, visibility: "org" }) } as never,
    {
      latestSucceeded: () => Promise.resolve(scan),
      findById: (_org: unknown, id: ScanId) =>
        Promise.resolve(id === OTHER_SCAN ? { ...scan, id, state: "failed" } : scan),
    } as never,
    {
      read: () => {
        reads += 1;
        return Promise.resolve({ document: GRAPH_DOC, bytes: 1 });
      },
    } as never,
  );
  return { useCase, reads: () => reads };
};

const reader = holding("project.graph.read");

describe("QueryGraphUseCase", () => {
  it("answers routes and insights from the latest scan, reading the file once", async () => {
    const { useCase, reads } = setup();
    const routes = await useCase.routes(reader, { projectId: PROJECT });
    const insights = await useCase.insights(reader, { projectId: PROJECT });

    expect(routes).toMatchObject({ scanId: SCAN, routes: [{ id: "GET /user" }] });
    expect(insights).toMatchObject({ files: 3, insights: { unguardedRoutes: ["GET /user"] } });
    expect(reads()).toBe(1);
  });

  it("reports a file's dependents and the routes they reach", async () => {
    const { useCase } = setup();
    const impact = await useCase.impact(reader, {
      projectId: PROJECT,
      path: "src/user/user.service.ts",
    });

    expect(impact.dependents).toEqual([{ path: "src/user/user.controller.ts", depth: 1 }]);
    expect(impact.routes.map((route) => route.id)).toEqual(["GET /user"]);
  });

  it("refuses a file the graph does not have, and a scan that did not succeed", async () => {
    const { useCase } = setup();
    await expect(
      useCase.impact(reader, { projectId: PROJECT, path: "src/missing.ts" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      useCase.routes(reader, { projectId: PROJECT, scanId: OTHER_SCAN }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("answers NOT_FOUND to someone who cannot read the project", async () => {
    const { useCase, reads } = setup();
    await expect(useCase.routes(holding(), { projectId: PROJECT })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(reads()).toBe(0);
  });
});
