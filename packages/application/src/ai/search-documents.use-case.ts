import { UnavailableError, ValidationError } from "../import.js";
import type {
  ActivityLogger,
  EmbeddingProvider,
  SearchHit,
  UnitOfWork,
  VectorStore,
} from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";

export interface SearchDocumentsInput {
  readonly query: string;
  readonly limit: number;
  // The candidate goals to narrow to, already known to the caller. Empty means the
  // org-wide corpus, which is what an app with no goal feature asks for.
  readonly goalIds?: readonly string[];
}

export class SearchDocumentsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly embeddings: EmbeddingProvider,
    private readonly vectors: VectorStore,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(
    actor: Principal,
    input: SearchDocumentsInput,
  ): Promise<readonly SearchHit[]> {
    this.authorizer.assert(actor, "ai.embedding.read");

    const query = input.query.trim();
    if (query.length === 0) throw new ValidationError([{ field: "query", rule: "required" }]);

    const [embedding] = await this.embeddings.embed([query]);
    // A provider that answered with nothing would otherwise search on `undefined` and
    // return the corpus ordered by an accident.
    if (!embedding) throw new UnavailableError("embedding.provider");

    // Resolved on the *input* set, never on the results: filtering afterwards means the
    // ranking already saw documents the actor may not read.
    const goalIds = actor.capabilities.goalsWith("ai.embedding.read", input.goalIds ?? []);

    const hits = await this.vectors.search(actor.organizationId, embedding, goalIds, input.limit);

    // A search is a business fact — what someone looked for is the question an audit
    // asks after a leak — so it is recorded, in a unit of work for the freeze (`CR.11`).
    await this.unitOfWork.run(() =>
      this.activity.record(actor, "ai.document.searched", {
        query,
        hits: hits.length,
      }),
    );

    return hits;
  }
}
