import {
  GRAPH_VERSION,
  type GraphDocument,
  type ProjectId,
  type ScanId,
} from "@loadbearing/contracts";
import { ValidationError } from "@loadbearing/errors";
import { CapabilitySet } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import {
  type AiSettingsRecord,
  AiSettingsRepository,
} from "../../src/ask/ai-settings.repository.js";
import { AskContext } from "../../src/ask/ask-context.js";
import { AskProjectUseCase } from "../../src/ask/ask-project.use-case.js";
import { ChatProvider, type ChatRequest } from "../../src/ask/chat-provider.js";
import { ManageAiSettingsUseCase } from "../../src/ask/manage-ai-settings.use-case.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";
import {
  ACTOR,
  DirectUnitOfWork,
  holding,
  ORG,
  RecordingActivity,
} from "../support/wiremap-fakes.js";

const PROJECT = "018f8c00-0000-7000-8000-0000000000c1" as ProjectId;
const SCAN = "018f8c00-0000-7000-8000-0000000000e1" as ScanId;

const file = (
  path: string,
  role: GraphDocument["files"][number]["role"],
  exports: string[] = [],
) => ({
  path,
  repository: "acme/api",
  language: "typescript" as const,
  role,
  loc: 20,
  exports,
});

const DOC: GraphDocument = {
  version: GRAPH_VERSION,
  meta: {
    analyzer: "t",
    generatedAt: "2026-10-03T00:00:00.000Z",
    repositories: [{ name: "acme/api", commit: "abc123", branch: "main" }],
    timings: { totalMs: 1 },
  },
  languages: [],
  frameworks: [{ id: "nestjs", repository: "acme/api" }],
  files: [
    file("src/user/user.service.ts", "service", ["UserService"]),
    file("src/user/user.controller.ts", "controller", ["UserController"]),
    file("src/shared/db.ts", "utility", ["db"]),
  ],
  edges: [
    {
      from: "src/user/user.controller.ts",
      to: "src/user/user.service.ts",
      kind: "import",
      certain: true,
    },
  ],
  unresolved: [],
  coverage: { resolved: 1, total: 1 },
  routes: [
    {
      id: "GET /user",
      method: "GET",
      path: "/user",
      file: "src/user/user.controller.ts",
      line: 9,
      framework: "nestjs",
      guards: [],
      source: "static",
    },
  ],
  calls: [],
  insights: {
    mostDepended: [{ path: "src/user/user.service.ts", dependents: 1 }],
    cycles: [],
    unusedFiles: [],
    unusedExports: [],
    unguardedRoutes: ["GET /user"],
  },
};

class Settings extends AiSettingsRepository {
  public record: AiSettingsRecord | null = null;
  public find() {
    return Promise.resolve(this.record);
  }
  public save(_org: unknown, settings: AiSettingsRecord) {
    this.record = settings;
    return Promise.resolve();
  }
}

class Chat extends ChatProvider {
  public readonly requests: ChatRequest[] = [];
  public async *stream(request: ChatRequest) {
    this.requests.push(request);
    yield "The user service ";
    yield "is at src/user/user.service.ts:1.";
  }
  public test(apiKey: string) {
    return Promise.resolve(apiKey === "AIza-good-key");
  }
}

const cipher = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ""),
};

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

const asker = () =>
  new Principal(
    ORG,
    ACTOR,
    CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: { [PROJECT]: { grants: ["project.graph.read", "project.ask.use"], denies: [] } },
    }),
  );

const setup = (enabled = true) => {
  const settings = new Settings();
  settings.record = {
    enabled,
    provider: "gemini",
    model: "gemini-2.5-flash",
    encryptedKey: "enc:AIza-good-key",
    keyHint: "••••-key",
  };
  const chat = new Chat();
  const cache = new MemoryCache();
  const fetched: string[] = [];
  const project = {
    id: PROJECT,
    repositories: [{ fullName: "acme/api", installationId: 9, provider: "github" }],
  };
  const useCase = new AskProjectUseCase(
    new Authorizer(),
    { findById: () => Promise.resolve(project) } as never,
    {
      latestSucceeded: () => Promise.resolve({ id: SCAN, graphKey: "k" }),
      summary: () => Promise.resolve(null),
      saveSummary: () => Promise.resolve(),
    } as never,
    { read: () => Promise.resolve({ document: DOC, bytes: 1 }) } as never,
    settings,
    cipher as never,
    chat,
    {
      fileAt: (_i: number, _r: string, ref: string, path: string) => {
        fetched.push(`${ref}:${path}`);
        return Promise.resolve("export class UserService {}\n");
      },
    } as never,
    cache as never,
    { hit: () => Promise.resolve(1) } as never,
  );
  return { useCase, chat, cache, fetched };
};

const collect = async (iterable: AsyncIterable<unknown>) => {
  const out: unknown[] = [];
  for await (const each of iterable) out.push(each);
  return out;
};

describe("AskContext", () => {
  it("grounds a question on the files it names, with their neighbours and the routes", () => {
    const grounding = AskContext.ground(DOC, "What does the UserService do?", null);
    expect(grounding.files[0]).toBe("src/user/user.service.ts");
    expect(grounding.overview).toContain("GET /user → src/user/user.controller.ts:9 [no guard]");
    expect(grounding.overview).toContain("imported by: src/user/user.controller.ts");
    expect(AskContext.ground(DOC, "Summarise", "onboarding").files).toContain(
      "src/user/user.service.ts",
    );
    expect(AskContext.numbered("a.ts", "x\ny", 10)).toBe("--- a.ts ---\n1| x\n2| y");
  });
});

describe("AskProjectUseCase", () => {
  it("streams an answer grounded on contents at the scanned commit, then serves it from cache", async () => {
    const { useCase, chat, fetched } = setup();
    const input = {
      projectId: PROJECT,
      question: "What does UserService do?",
      preset: null,
      history: [],
    };

    const first = await collect(useCase.execute(asker(), input));
    expect(first).toEqual([
      { kind: "text", text: "The user service " },
      { kind: "text", text: "is at src/user/user.service.ts:1." },
      {
        kind: "done",
        cached: false,
        scanId: SCAN,
        files: expect.arrayContaining(["src/user/user.service.ts"]),
      },
    ]);
    expect(fetched).toContain("abc123:src/user/user.service.ts");
    expect(chat.requests[0]?.apiKey).toBe("AIza-good-key");
    expect(chat.requests[0]?.turns.at(-1)?.text).toContain("1| export class UserService {}");

    const again = await collect(useCase.execute(asker(), input));
    expect(again.at(-1)).toMatchObject({ kind: "done", cached: true });
    expect(chat.requests).toHaveLength(1);
  });

  it("refuses when the organization has Ask off", async () => {
    const { useCase } = setup(false);
    await expect(
      collect(
        useCase.execute(asker(), { projectId: PROJECT, question: "x?", preset: null, history: [] }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("ManageAiSettingsUseCase", () => {
  it("stores the key encrypted, shows its last four, and requires one to turn Ask on", async () => {
    const settings = new Settings();
    const useCase = new ManageAiSettingsUseCase(
      new Authorizer(),
      settings,
      cipher as never,
      new Chat(),
      new RecordingActivity(),
      new DirectUnitOfWork(),
    );
    const admin = holding("organization.ai.manage");

    await expect(
      useCase.update(admin, { enabled: true, provider: "gemini", model: "gemini-2.5-flash" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const view = await useCase.update(admin, {
      enabled: true,
      provider: "gemini",
      model: "gemini-2.5-flash",
      apiKey: "AIza-good-key",
    });

    expect(view).toEqual({
      enabled: true,
      provider: "gemini",
      model: "gemini-2.5-flash",
      keyHint: "••••-key",
    });
    expect(settings.record?.encryptedKey).toBe("enc:AIza-good-key");
    expect(await useCase.test(admin)).toEqual({ ok: true });
    expect(await useCase.available(admin)).toEqual({ available: true });
    expect(
      (await useCase.update(admin, { enabled: false, provider: "gemini", model: "m" })).keyHint,
    ).toBe("••••-key");
  });
});
