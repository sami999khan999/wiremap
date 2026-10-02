import { QueueName } from "../import.js";
import { QueueConsumer } from "./queue.consumer.js";
import type { QueueJob } from "./queue-job.js";
import { SystemPrincipal } from "./system-principal.js";

interface EmbeddingJobData {
  readonly organizationId: string;
  // Absent on a `reembed` job, which names only the tenant: `pnpm ai:reindex` queues one.
  readonly documentId: string;
  readonly text: string;
  readonly goalId?: string | null;
  readonly sourceType?: string;
  // Absent on a job queued before `CR.33`, which then indexes unconditionally.
  readonly version?: number;
}

export class EmbeddingConsumer extends QueueConsumer {
  public readonly queue = QueueName.EMBEDDING;

  public async handle(job: QueueJob): Promise<void> {
    const data = job.data as EmbeddingJobData;
    const principal = SystemPrincipal.forOrganization(data.organizationId);

    // `document_chunks` is routed, so the job is placed before the use-case runs.
    if (job.name === "reembed") {
      await this.placed(data.organizationId, () => this.container.ai.reembed.execute(principal));
      return;
    }

    await this.placed(data.organizationId, () =>
      this.container.ai.indexDocument.execute(principal, {
        documentId: data.documentId,
        text: data.text,
        goalId: data.goalId ?? null,
        sourceType: data.sourceType ?? "document",
        ...(data.version === undefined ? {} : { version: data.version }),
      }),
    );
  }
}
