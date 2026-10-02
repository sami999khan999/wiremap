import { Identifiers } from "@loadbearing/contracts";
import { ForbiddenError, NotFoundError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { CreateDocPageUseCase } from "../../src/doc/create-doc-page.use-case.js";
import { CreateDocSpaceUseCase } from "../../src/doc/create-doc-space.use-case.js";
import { DeleteDocPageUseCase } from "../../src/doc/delete-doc-page.use-case.js";
import { DeleteDocSpaceUseCase } from "../../src/doc/delete-doc-space.use-case.js";
import { MoveDocPageUseCase } from "../../src/doc/move-doc-page.use-case.js";
import { PublishDocPageUseCase } from "../../src/doc/publish-doc-page.use-case.js";
import { RestoreDocRevisionUseCase } from "../../src/doc/restore-doc-revision.use-case.js";
import { SaveDocPageUseCase } from "../../src/doc/save-doc-page.use-case.js";
import { UpdateDocSpaceUseCase } from "../../src/doc/update-doc-space.use-case.js";
import { UploadDocImageUseCase } from "../../src/doc/upload-doc-image.use-case.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";

// "To change an organization's docs you must belong to it": every write asserts its key
// against the actor's own organization and reads nothing under any other.

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const OTHER_ORG = "018f8c00-0000-7000-8000-0000000000ff";
const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
// Ids that exist only in another organization: every lookup in the actor's answers nothing.
const SPACE = Identifiers.docSpaceId.parse("018f8c00-0000-7000-8000-0000000000a1");
const PAGE = Identifiers.docPageId.parse("018f8c00-0000-7000-8000-0000000000b1");

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

// Every dependency at once: each method resolves to nothing and is recorded, `run` runs its
// work, and the platform organization is another one, so nothing here is platform-scoped.
const recorder = () => {
  const calls: Call[] = [];
  const fake: unknown = new Proxy(
    {},
    {
      get: (_target, method: string) => {
        if (method === "then") return undefined;
        return (...args: unknown[]) => {
          calls.push({ method, args });
          if (method === "run") return (args[0] as () => Promise<unknown>)();
          if (method === "organizationId") return Promise.resolve(OTHER_ORG);
          return Promise.resolve(null);
        };
      },
    },
  );
  return { calls, fake: fake as never };
};

const actorHolding = (...grants: PermissionKey[]) =>
  new Principal(
    ORG,
    ACTOR,
    CapabilitySet.from({ wildcard: false, org: { grants, denies: [] }, goals: {} }),
  );

type Run = (actor: Principal, fake: never) => Promise<unknown>;

const SPACE_FIELDS = {
  slug: "guide",
  title: "Guide",
  description: null,
  icon: null,
  audience: "members",
  theme: null,
  access: null,
  repositoryUrl: null,
} as const;

const DEPENDENCIES = (count: number, fake: never) => Array.from({ length: count }, () => fake);

// Each write, the key it needs, and how to call it with every dependency faked.
const WRITES: readonly { name: string; key: PermissionKey; finds: boolean; run: Run }[] = [
  {
    name: "create a space",
    key: "doc.space.manage",
    finds: false,
    run: (actor, fake) =>
      new CreateDocSpaceUseCase(
        new Authorizer(),
        ...(DEPENDENCIES(6, fake) as [never, never, never, never, never, never]),
      ).execute(actor, SPACE_FIELDS),
  },
  {
    name: "update a space",
    key: "doc.space.manage",
    finds: true,
    run: (actor, fake) =>
      new UpdateDocSpaceUseCase(
        new Authorizer(),
        ...(DEPENDENCIES(6, fake) as [never, never, never, never, never, never]),
      ).execute(actor, {
        ...SPACE_FIELDS,
        spaceId: SPACE,
        position: 0,
      }),
  },
  {
    name: "delete a space",
    key: "doc.space.manage",
    finds: true,
    run: (actor, fake) =>
      new DeleteDocSpaceUseCase(
        new Authorizer(),
        ...(DEPENDENCIES(8, fake) as [never, never, never, never, never, never, never, never]),
      ).execute(actor, { spaceId: SPACE }),
  },
  {
    name: "create a page",
    key: "doc.page.write",
    finds: true,
    run: (actor, fake) =>
      new CreateDocPageUseCase(
        new Authorizer(),
        ...(DEPENDENCIES(6, fake) as [never, never, never, never, never, never]),
      ).execute(actor, {
        spaceId: SPACE,
        parentId: null,
        kind: "page",
        slug: "start",
        title: "Start",
        icon: null,
        url: null,
      }),
  },
  {
    name: "save a page",
    key: "doc.page.write",
    finds: true,
    run: (actor, fake) =>
      new SaveDocPageUseCase(
        new Authorizer(),
        ...(DEPENDENCIES(6, fake) as [never, never, never, never, never, never]),
      ).execute(actor, {
        pageId: PAGE,
        draftVersion: 1,
        slug: "start",
        title: "Start",
        description: null,
        icon: null,
        markdown: "x",
        url: null,
      }),
  },
  {
    name: "publish a page",
    key: "doc.page.publish",
    finds: true,
    run: (actor, fake) =>
      new PublishDocPageUseCase(
        new Authorizer(),
        ...(DEPENDENCIES(7, fake) as [never, never, never, never, never, never, never]),
      ).execute(actor, {
        pageId: PAGE,
        draftVersion: 1,
      }),
  },
  {
    name: "move a page",
    key: "doc.page.write",
    finds: true,
    run: (actor, fake) =>
      new MoveDocPageUseCase(
        new Authorizer(),
        ...(DEPENDENCIES(6, fake) as [never, never, never, never, never, never]),
      ).execute(actor, {
        pageId: PAGE,
        parentId: null,
        position: 0,
      }),
  },
  {
    name: "delete a page",
    key: "doc.page.write",
    finds: true,
    run: (actor, fake) =>
      new DeleteDocPageUseCase(
        new Authorizer(),
        ...(DEPENDENCIES(6, fake) as [never, never, never, never, never, never]),
      ).execute(actor, { pageId: PAGE }),
  },
  {
    name: "restore a revision",
    key: "doc.page.write",
    finds: true,
    run: (actor, fake) =>
      new RestoreDocRevisionUseCase(
        new Authorizer(),
        ...(DEPENDENCIES(4, fake) as [never, never, never, never]),
      ).execute(actor, {
        pageId: PAGE,
        revisionNo: 1,
        draftVersion: 1,
      }),
  },
  {
    name: "upload an image",
    key: "doc.page.write",
    finds: true,
    run: (actor, fake) =>
      new UploadDocImageUseCase(
        new Authorizer(),
        ...(DEPENDENCIES(2, fake) as [never, never]),
      ).execute(actor, {
        spaceId: SPACE,
        contentType: "image/png",
        size: 1024,
      }),
  },
];

describe("doc writes", () => {
  for (const write of WRITES) {
    it(`${write.name}: refused without ${write.key}, touching nothing`, async () => {
      const { calls, fake } = recorder();
      await expect(write.run(actorHolding("doc.page.read"), fake)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      expect(calls).toEqual([]);
    });

    if (!write.finds) continue;

    // The ids belong to another organization, so under the actor's they are not found.
    it(`${write.name}: another organization's ids are not found, and only the actor's is read`, async () => {
      const { calls, fake } = recorder();
      await expect(
        write.run(
          actorHolding("doc.page.read", "doc.page.write", "doc.page.publish", "doc.space.manage"),
          fake,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);

      const organizations = calls
        .map((call) => call.args[0])
        .filter(
          (arg) => typeof arg === "string" && Identifiers.organizationId.safeParse(arg).success,
        );
      expect(organizations.length).toBeGreaterThan(0);
      expect(new Set(organizations)).toEqual(new Set([ORG]));
    });
  }
});
