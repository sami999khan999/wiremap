import { CapabilitySet, ConflictError, type OrganizationId, type UserId } from "../import.js";
import type {
  ActivityLogger,
  ShardAssignmentRepository,
  TableRowCount,
  TenantMoveGateway,
} from "../port/index.js";
import { Principal, Shard } from "../primitive/index.js";
import type { PlatformReader } from "./platform.reader.js";
import type { PlatformPolicyRepository } from "./platform-policy.repository.js";

export interface RelocateTenantInput {
  readonly organizationId: OrganizationId;
  readonly toNode: number;
  // Who asked, carried through the queue so the audit row still names a person.
  readonly actorId: UserId;
}

export interface RelocatedTenant {
  readonly fromNode: number;
  readonly toNode: number;
  readonly rows: number;
  readonly droppableAt: Date;
}

// The job half, run **placed on nothing**: every call names its node explicitly, because
// a move is the one operation that is not on one node.
export class RelocateTenantUseCase {
  public constructor(
    private readonly assignments: ShardAssignmentRepository,
    private readonly move: TenantMoveGateway,
    private readonly policy: PlatformPolicyRepository,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    private readonly clock: { now(): Date },
    // The deployment's own default, from the environment. `platform_policy` overrides
    // it when an operator has set one; null there means "use this".
    private readonly defaultGraceDays: number,
  ) {}

  public async execute(input: RelocateTenantInput): Promise<RelocatedTenant> {
    const key = Shard.keyOf(input.organizationId);

    // **The lock, and it is one statement.** False means a move is already in flight or
    // the tenant is already there — either way this job has nothing to do.
    if (!(await this.assignments.beginMove(key, input.toNode))) {
      throw new ConflictError("shard", "moving");
    }

    const assignment = await this.assignments.findByKey(key);
    // `node` is still the source here: `moved_from` is not stamped until the flip.
    const fromNode = assignment?.node ?? 0;

    try {
      // Before the copy reads a row: a writer placed before the freeze would otherwise
      // land a row on the source after its page was read, and the flip would lose it.
      await this.move.quiesce(input.organizationId, fromNode);

      // DDL first: inserting into a partitioned table with no partition for the tenant
      // is an error rather than a no-op, so the target is prepared before anything moves.
      await this.move.prepare(input.organizationId, fromNode, input.toNode);
      const copied = await this.move.copy(input.organizationId, fromNode, input.toNode);

      await this.verify(input.organizationId, fromNode, input.toNode);

      const droppableAt = this.droppableAt(await this.graceDays());
      await this.assignments.completeMove(key, droppableAt);

      await this.record(input, fromNode, copied);
      return {
        fromNode,
        toNode: input.toNode,
        rows: copied.reduce((total, entry) => total + entry.rows, 0),
        droppableAt,
      };
    } catch (failure) {
      // **The freeze is lifted on any failure.** Nothing was flipped, so the tenant is
      // where it was; leaving it frozen would be an outage caused by a retryable error.
      await this.assignments.abandonMove(key);
      throw failure;
    }
  }

  // Counted on both nodes rather than trusting the copy's own tally: the question is
  // what arrived, and a copy reporting on itself cannot answer it.
  private async verify(
    organizationId: OrganizationId,
    fromNode: number,
    toNode: number,
  ): Promise<void> {
    const source = await this.move.counts(organizationId, fromNode);
    const target = new Map(
      (await this.move.counts(organizationId, toNode)).map((entry) => [entry.table, entry.rows]),
    );

    for (const entry of source) {
      // Greater is fine and less is not. `prepare` empties the target, so greater is a
      // source month the retention pass archived mid-copy — never a stale earlier attempt.
      if ((target.get(entry.table) ?? 0) < entry.rows) {
        throw new ConflictError("shard", "rowCount");
      }
    }
  }

  // The operator's number when they have set one, the deployment's otherwise. Null is
  // not zero, which is why this reads the row rather than coalescing in SQL.
  private async graceDays(): Promise<number> {
    const policy = await this.policy.get();
    return policy.moveGraceDays ?? this.defaultGraceDays;
  }

  private droppableAt(days: number): Date {
    return new Date(this.clock.now().getTime() + days * 24 * 60 * 60 * 1000);
  }

  private async record(
    input: RelocateTenantInput,
    fromNode: number,
    copied: readonly TableRowCount[],
  ): Promise<void> {
    // `system`, and with no capabilities: this actor authorizes nothing, it only names
    // who asked. The permission was asserted when the job was queued.
    const auditor = Principal.system(
      await this.platform.organizationId(),
      input.actorId,
      CapabilitySet.empty(),
    );

    await this.activity.record(auditor, "tenant.moved", {
      organizationId: input.organizationId,
      fromNode,
      toNode: input.toNode,
      rows: copied.reduce((total, entry) => total + entry.rows, 0),
    });
  }
}
