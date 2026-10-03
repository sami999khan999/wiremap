import {
  type GraphDocument,
  NotFoundError,
  type ProjectId,
  RateLimitedError,
  type ScanId,
  ValidationError,
} from "../import.js";
import type {
  CacheStore,
  RateLimitStore,
  RepositoryProvider,
  SecretCipher,
} from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { ProjectAccess, type ProjectRecord, type ProjectRepository } from "../project/index.js";
import type { GraphArchive, ScanRepository } from "../scan/index.js";
import type { AiSettingsRepository } from "./ai-settings.repository.js";
import { AskContext, type AskPreset } from "./ask-context.js";
import type { CancelSignal, ChatProvider, ChatTurn } from "./chat-provider.js";

export type AskChunkRecord =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "done";
      readonly cached: boolean;
      readonly scanId: ScanId;
      readonly files: readonly string[];
    };

export interface AskInput {
  readonly projectId: ProjectId;
  readonly question: string;
  readonly preset: AskPreset | null;
  readonly history: readonly ChatTurn[];
}

// A question answered from the latest graph and a few files read live at the scanned commit,
// never stored. The organization's key pays. See application/docs/reference/ask.md.
export class AskProjectUseCase {
  private static readonly ORG_PER_DAY = 200;
  private static readonly ANSWER_TTL = 3_600;
  private static readonly FILE_TTL = 600;
  private static readonly MAX_FILE_BYTES = 40_000;
  private static readonly MAX_FILE_LINES = 400;

  public constructor(
    private readonly authorizer: Authorizer,
    private readonly projects: ProjectRepository,
    private readonly scans: ScanRepository,
    private readonly archive: GraphArchive,
    private readonly settings: AiSettingsRepository,
    private readonly cipher: SecretCipher,
    private readonly chat: ChatProvider,
    private readonly provider: RepositoryProvider,
    private readonly cache: CacheStore,
    private readonly rateLimits: RateLimitStore,
  ) {}

  public async *execute(
    actor: Principal,
    input: AskInput,
    signal?: CancelSignal,
  ): AsyncGenerator<AskChunkRecord> {
    const project = await ProjectAccess.load(
      this.authorizer,
      this.projects,
      actor,
      input.projectId,
      "project.ask.use",
    );
    const settings = await this.settings.find(actor.organizationId);
    if (!settings?.enabled || settings.provider === "none" || !settings.encryptedKey) {
      throw new ValidationError([{ field: "ai", rule: "off" }]);
    }
    const scan = await this.scans.latestSucceeded(actor.organizationId, project.id);
    if (!scan?.graphKey) throw new NotFoundError("graph", project.id);

    // The onboarding summary is per scan and kept with it: one reader pays, the rest read it.
    const onboarding = input.preset === "onboarding" && input.history.length === 0;
    const stored = onboarding ? await this.scans.summary(actor.organizationId, scan.id) : null;
    if (stored) {
      yield { kind: "text", text: stored };
      yield { kind: "done", cached: true, scanId: scan.id, files: [] };
      return;
    }

    // An answer already given for this scan and question costs nothing to give again.
    const key = `ask:${scan.id}:${AskProjectUseCase.hash(`${input.preset ?? ""}|${input.question.trim().toLowerCase()}|${input.history.length}`)}`;
    const cached =
      input.history.length === 0
        ? await this.cache.get<{ text: string; files: string[] }>(key)
        : null;
    if (cached) {
      yield { kind: "text", text: cached.text };
      yield { kind: "done", cached: true, scanId: scan.id, files: cached.files };
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    if (
      (await this.rateLimits.hit(`ask:org:${actor.organizationId}:${today}`, 86_400)) >
      AskProjectUseCase.ORG_PER_DAY
    ) {
      throw new RateLimitedError("ask");
    }

    const read = await this.archive.read(scan.graphKey);
    if ("refused" in read) throw new NotFoundError("graph", scan.id);
    const grounding = AskContext.ground(read.document, input.question, input.preset);
    const contents = await this.contents(project, read.document, grounding.files);

    const context = [grounding.overview, ...contents].join("\n\n");
    const turns: ChatTurn[] = [
      ...input.history,
      {
        role: "user",
        text: `Context about the codebase:\n\n${context}\n\nQuestion: ${input.question}`,
      },
    ];
    let text = "";
    for await (const piece of this.chat.stream(
      {
        apiKey: this.cipher.decrypt(settings.encryptedKey),
        model: settings.model,
        system: AskContext.system(),
        turns,
      },
      signal,
    )) {
      text += piece;
      yield { kind: "text", text: piece };
    }
    if (input.history.length === 0 && text.trim() !== "") {
      await this.cache.set(key, { text, files: grounding.files }, AskProjectUseCase.ANSWER_TTL);
      if (onboarding) await this.scans.saveSummary(actor.organizationId, scan.id, text);
    }
    yield { kind: "done", cached: false, scanId: scan.id, files: grounding.files };
  }

  // Each picked file's text at the scanned commit, numbered for citation. A repository the
  // App cannot read (an uploaded graph) contributes no contents; the graph still grounds.
  private async contents(
    project: ProjectRecord,
    document: GraphDocument,
    paths: readonly string[],
  ): Promise<string[]> {
    const multi = document.meta.repositories.length > 1;
    const out: string[] = [];
    for (const path of paths) {
      const file = document.files.find((each) => each.path === path);
      if (!file) continue;
      const repository = project.repositories.find((each) => each.fullName === file.repository);
      const meta = document.meta.repositories.find((each) => each.name === file.repository);
      if (!repository?.installationId || !meta?.commit) continue;
      const local = multi ? path.slice(path.indexOf("/") + 1) : path;
      const cacheKey = `ask:file:${repository.fullName}:${meta.commit}:${local}`;
      let text = await this.cache.get<string>(cacheKey);
      if (text === null) {
        text =
          (await this.provider
            .fileAt(repository.installationId, repository.fullName, meta.commit, local)
            .catch(() => null)) ?? "";
        text = text.slice(0, AskProjectUseCase.MAX_FILE_BYTES);
        await this.cache.set(cacheKey, text, AskProjectUseCase.FILE_TTL);
      }
      if (text !== "") out.push(AskContext.numbered(path, text, AskProjectUseCase.MAX_FILE_LINES));
    }
    return out;
  }

  // FNV-1a over two seeds: a cache key needs spread, not secrecy, and the domain stays free
  // of a crypto import.
  private static hash(value: string): string {
    const fnv = (seed: number) => {
      let hash = seed;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619) >>> 0;
      }
      return hash.toString(16).padStart(8, "0");
    };
    return `${fnv(2_166_136_261)}${fnv(374_761_393)}`;
  }
}
