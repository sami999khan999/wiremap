import type { CommentId, OrganizationId, ProjectId, UserId } from "@loadbearing/contracts";
import { ForbiddenError, ValidationError } from "@loadbearing/errors";
import { CapabilitySet } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { type CommentRecord, CommentRepository } from "../../src/comment/comment.repository.js";
import { CommentRules } from "../../src/comment/comment.rules.js";
import { ManageCommentsUseCase } from "../../src/comment/manage-comments.use-case.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";
import {
  ACTOR,
  CLOCK,
  DirectUnitOfWork,
  ORG,
  OTHER,
  RecordingActivity,
} from "../support/wiremap-fakes.js";

const PROJECT = "018f8c00-0000-7000-8000-0000000000c1" as ProjectId;

class MemoryComments extends CommentRepository {
  public readonly rows: CommentRecord[] = [];
  public list() {
    return Promise.resolve(this.rows);
  }
  public findById(_org: OrganizationId, id: CommentId) {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }
  public save(
    _org: OrganizationId,
    comment: Omit<CommentRecord, "resolvedAt" | "pinned" | "editedAt" | "createdAt">,
  ) {
    this.rows.push({
      ...comment,
      resolvedAt: null,
      pinned: false,
      editedAt: null,
      createdAt: new Date(),
    });
    return Promise.resolve();
  }
  private patch(id: CommentId, change: Partial<CommentRecord>) {
    const index = this.rows.findIndex((row) => row.id === id);
    this.rows[index] = { ...(this.rows[index] as CommentRecord), ...change };
    return Promise.resolve();
  }
  public edit(_org: OrganizationId, id: CommentId, body: string, at: Date) {
    return this.patch(id, { body, editedAt: at });
  }
  public setResolved(_org: OrganizationId, id: CommentId, at: Date | null) {
    return this.patch(id, { resolvedAt: at });
  }
  public setPinned(_org: OrganizationId, id: CommentId, pinned: boolean) {
    return this.patch(id, { pinned });
  }
  public remove(_org: OrganizationId, id: CommentId) {
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

const writer = (userId: UserId, extra: string[] = []) =>
  new Principal(
    ORG,
    userId,
    CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: {
        [PROJECT]: {
          grants: ["project.graph.read", "project.comment.write", ...extra] as never,
          denies: [],
        },
      },
    }),
  );

const setup = () => {
  const comments = new MemoryComments();
  const published: { name: string; payload: Record<string, unknown> }[] = [];
  const activity = new RecordingActivity();
  const useCase = new ManageCommentsUseCase(
    new Authorizer(),
    { findById: () => Promise.resolve({ id: PROJECT }) } as never,
    comments,
    {
      namesOf: () =>
        Promise.resolve(
          new Map([
            [ACTOR, "Ada"],
            [OTHER, "Grace"],
          ]),
        ),
    } as never,
    {
      publish: (_actor: unknown, event: { name: string; payload: Record<string, unknown> }) => {
        published.push(event);
        return Promise.resolve();
      },
    } as never,
    activity,
    new DirectUnitOfWork(),
    CLOCK,
  );
  return { activity, comments, published, useCase };
};

describe("ManageCommentsUseCase", () => {
  it("threads a reply under its root, names the thread's author and the mentioned", async () => {
    const { activity, useCase, published } = setup();
    const target = { kind: "file" as const, key: "src/a.ts" };
    const root = await useCase.create(writer(ACTOR), {
      projectId: PROJECT,
      target,
      body: "Why?",
      parentId: null,
    });
    const reply = await useCase.create(writer(OTHER), {
      projectId: PROJECT,
      target,
      body: `Because @[${ACTOR}] said`,
      parentId: root.id,
    });
    const nested = await useCase.create(writer(OTHER), {
      projectId: PROJECT,
      target,
      body: "And more",
      parentId: reply.id,
    });

    expect(nested.parentId).toBe(root.id);
    expect(reply.authorName).toBe("Grace");
    expect(published[1]?.payload).toMatchObject({
      replyTo: ACTOR,
      mentions: [ACTOR],
      excerpt: "Because @someone said",
    });
    expect(activity.actions()).toEqual(["comment.created", "comment.created", "comment.created"]);
  });

  it("lets only the author edit, and the author or a project admin remove", async () => {
    const { useCase, comments } = setup();
    const comment = await useCase.create(writer(ACTOR), {
      projectId: PROJECT,
      target: { kind: "project", key: "" },
      body: "Note",
      parentId: null,
    });

    await expect(
      useCase.update(writer(OTHER), { projectId: PROJECT, commentId: comment.id, body: "x" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      useCase.remove(writer(OTHER), { projectId: PROJECT, commentId: comment.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      (await useCase.pin(writer(OTHER), { projectId: PROJECT, commentId: comment.id, on: true }))
        .pinned,
    ).toBe(true);
    await useCase.remove(writer(OTHER, ["project.settings.manage"]), {
      projectId: PROJECT,
      commentId: comment.id,
    });
    expect(comments.rows).toEqual([]);
  });
});

describe("CommentRules", () => {
  it("reads mentions only in their written form", () => {
    expect(CommentRules.mentions(`hi @[${OTHER}] and @ada and @[${OTHER}]`)).toEqual([OTHER]);
  });
});
