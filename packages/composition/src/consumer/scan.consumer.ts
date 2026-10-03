import { type OrganizationId, QueueName, type ScanId } from "../import.js";
import { QueueConsumer } from "./queue.consumer.js";
import type { QueueJob } from "./queue-job.js";

interface DispatchJob {
  readonly organizationId: OrganizationId;
  readonly scanId: ScanId;
}

// Starts a queued scan's runner. A throw is retried by whichever host delivered the job.
export class ScanConsumer extends QueueConsumer {
  public readonly queue = QueueName.SCAN;

  public async handle(job: QueueJob): Promise<void> {
    if (job.name !== "dispatch") throw new Error(`Unknown scan job: ${job.name}`);
    const data = job.data as DispatchJob;
    await this.placed(data.organizationId, () => this.container.scans.dispatch.execute(data));
  }
}
