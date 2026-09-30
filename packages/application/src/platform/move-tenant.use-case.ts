import { ConflictError, NotFoundError, type OrganizationId } from "../import.js";
import type { ActivityLogger, QueuePublisher, ShardAssignmentRepository } from "../port/index.js";
import type { Authorizer } from "../primitive/index.js";
import { Principal, QueueName, Shard } from "../primitive/index.js";
import type { PlatformReader } from "./platform.reader.js";
import type { TenantRepository } from "./tenant.repository.js";

export interface MoveTenantInput {
  readonly organizationId: OrganizationId;
  readonly toNode: number;
}

export interface MoveRequested {
  readonly jobId: string;
}

// The request half. Every guard runs here so a mistake is a sentence on the screen
// rather than a worker failure nobody is watching — `RelocateTenantUseCase` does the work.
export class MoveTenantUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly tenants: TenantRepository,
    private readonly assignments: ShardAssignmentRepository,
    private readonly queue: QueuePublisher,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    // How many physical nodes this deployment has. A number rather than the cluster,
    // because `application` names no adapter — the DI root reads `cluster.size`.
    private readonly nodeCount: number,
  ) {}

  public async execute(actor: Principal, input: MoveTenantInput): Promise<MoveRequested> {
    this.authorizer.assert(actor, "platform.shards.manage");

    // Out of range before anything else: a move to a node that does not exist would
    // freeze the tenant and then fail, which is an outage for a typo.
    if (!Number.isInteger(input.toNode) || input.toNode < 0 || input.toNode >= this.nodeCount) {
      throw new ConflictError("shard", "node");
    }

    const tenant = await this.tenants.findBy(input.organizationId);
    if (!tenant) throw new NotFoundError("organization", input.organizationId);

    const key = Shard.keyOf(input.organizationId);
    const assignment = await this.assignments.findByKey(key);
    if (!assignment) throw new NotFoundError("shardAssignment", input.organizationId);

    // Refused here as well as in `beginMove`, which is the real lock. This one exists
    // so the operator reads why rather than watching a job claim nothing.
    if (assignment.movingTo !== null) throw new ConflictError("shard", "moving");
    if (assignment.node === input.toNode) throw new ConflictError("shard", "sameNode");
    // The last move's source copy is still on disk, and `moved_from` is the only thing
    // naming it. Moving back reuses that node; moving onward would orphan the copy.
    if (assignment.movedFrom !== null && assignment.movedFrom !== input.toNode) {
      throw new ConflictError("shard", "sourcePending");
    }

    // **No `:`** — BullMQ rejects a colon in a job id. One per tenant *in flight*, so a
    // second click while the first is queued is the same job, and moving back is not.
    const jobId = `tenant-move.${input.organizationId}`;

    const auditor = new Principal(
      await this.platform.organizationId(),
      actor.userId,
      actor.capabilities,
      actor.kind,
    );
    await this.activity.record(auditor, "tenant.move_requested", {
      organizationId: input.organizationId,
      slug: tenant.slug,
      fromNode: assignment.node,
      toNode: input.toNode,
    });

    await this.queue.publish(
      QueueName.MAINTENANCE,
      { organizationId: input.organizationId, toNode: input.toNode, actorId: actor.userId },
      { inFlightId: jobId, name: "tenant-move" },
    );

    return { jobId };
  }
}
