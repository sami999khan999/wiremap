import type { OrganizationId } from "@loadbearing/contracts";
import {
  type ActivityLogger,
  type ShardAssignment,
  ShardAssignmentRepository,
  type TableRowCount,
  TenantMoveGateway,
} from "../../src/port/index.js";
import type { Principal } from "../../src/primitive/principal.js";
import type { ShardKey } from "../../src/primitive/shard.js";

// Shared by the three move specs. The request, the job and the grace sweep read one
// directory, and three copies of its rules would drift apart the first time one changed.

export const unmoved = (key: ShardKey, node: number): ShardAssignment => ({
  key,
  node,
  movedAt: null,
  movingTo: null,
  movedFrom: null,
  sourceDroppableAt: null,
});

// The rules `PgShardAssignmentRepository` puts in its `where` clauses, restated: a
// double that always claimed would hide the double-start `beginMove` exists to refuse.
export class FakeAssignments extends ShardAssignmentRepository {
  private readonly rows = new Map<ShardKey, ShardAssignment>();

  public constructor(rows: readonly ShardAssignment[] = []) {
    super();
    for (const row of rows) this.rows.set(row.key, row);
  }

  public override findByKey(key: ShardKey): Promise<ShardAssignment | null> {
    return Promise.resolve(this.rows.get(key) ?? null);
  }

  public override save(assignment: { key: ShardKey; node: number }): Promise<void> {
    this.rows.set(assignment.key, unmoved(assignment.key, assignment.node));
    return Promise.resolve();
  }

  public override all(): Promise<readonly ShardAssignment[]> {
    return Promise.resolve([...this.rows.values()]);
  }

  public override beginMove(key: ShardKey, toNode: number): Promise<boolean> {
    const row = this.rows.get(key);
    if (!row || row.movingTo !== null || row.node === toNode) return Promise.resolve(false);
    if (row.movedFrom !== null && row.movedFrom !== toNode) return Promise.resolve(false);

    this.rows.set(key, { ...row, movingTo: toNode });
    return Promise.resolve(true);
  }

  public override completeMove(key: ShardKey, droppableAt: Date): Promise<void> {
    const row = this.rows.get(key);
    if (row?.movingTo === null || row === undefined) return Promise.resolve();

    this.rows.set(key, {
      ...row,
      node: row.movingTo,
      movedFrom: row.node,
      movingTo: null,
      movedAt: droppableAt,
      sourceDroppableAt: droppableAt,
    });
    return Promise.resolve();
  }

  public override abandonMove(key: ShardKey): Promise<void> {
    const row = this.rows.get(key);
    if (row) this.rows.set(key, { ...row, movingTo: null });
    return Promise.resolve();
  }

  public override droppableBefore(
    cutoff: Date,
    limit: number,
  ): Promise<readonly ShardAssignment[]> {
    const due = [...this.rows.values()].filter(
      (row) =>
        row.sourceDroppableAt !== null &&
        row.sourceDroppableAt < cutoff &&
        row.movedFrom !== null &&
        row.movingTo === null,
    );
    return Promise.resolve(due.slice(0, limit));
  }

  public override forgetSource(key: ShardKey): Promise<void> {
    const row = this.rows.get(key);
    if (row) this.rows.set(key, { ...row, movedFrom: null, sourceDroppableAt: null });
    return Promise.resolve();
  }
}

export type MoveStep = "quiesce" | "prepare" | "copy" | "carry" | "drop";

// Rows per node per table. `copy` can be told to lose some, which is the failure the
// verify step exists to catch: a copy that reports success and delivered less.
export class FakeMoveGateway extends TenantMoveGateway {
  public readonly steps: { step: MoveStep; node: number }[] = [];
  private readonly rows = new Map<number, Map<string, number>>();
  private failing: MoveStep | null = null;
  private losing = 0;

  public seed(node: number, table: string, rows: number): void {
    const forNode = this.rows.get(node) ?? new Map<string, number>();
    forNode.set(table, rows);
    this.rows.set(node, forNode);
  }

  public failAt(step: MoveStep): void {
    this.failing = step;
  }

  // The next copy delivers this many fewer rows per table than it read.
  public lose(rows: number): void {
    this.losing = rows;
  }

  public override quiesce(_organizationId: OrganizationId, node: number): Promise<void> {
    return this.record("quiesce", node);
  }

  public override async prepare(
    _organizationId: OrganizationId,
    _fromNode: number,
    toNode: number,
  ): Promise<void> {
    await this.record("prepare", toNode);
    this.rows.delete(toNode);
  }

  public override async copy(
    _organizationId: OrganizationId,
    fromNode: number,
    toNode: number,
  ): Promise<readonly TableRowCount[]> {
    await this.record("copy", toNode);
    const source = this.rows.get(fromNode) ?? new Map<string, number>();
    for (const [table, count] of source) this.seed(toNode, table, count - this.losing);

    return [...source].map(([table, rows]) => ({ table, rows }));
  }

  public override counts(
    _organizationId: OrganizationId,
    node: number,
  ): Promise<readonly TableRowCount[]> {
    const forNode = this.rows.get(node) ?? new Map<string, number>();
    return Promise.resolve([...forNode].map(([table, rows]) => ({ table, rows })));
  }

  public override async carryAudit(
    _organizationId: OrganizationId,
    _fromNode: number,
    toNode: number,
  ): Promise<number> {
    await this.record("carry", toNode);
    return 0;
  }

  public override async dropOn(
    _organizationId: OrganizationId,
    node: number,
  ): Promise<readonly string[]> {
    await this.record("drop", node);
    const dropped = [...(this.rows.get(node) ?? new Map<string, number>()).keys()];
    this.rows.delete(node);
    return dropped;
  }

  private record(step: MoveStep, node: number): Promise<void> {
    this.steps.push({ step, node });
    if (this.failing !== step) return Promise.resolve();

    this.failing = null;
    return Promise.reject(new Error(`${step} failed`));
  }
}

export class FakeActivity implements ActivityLogger {
  public readonly rows: {
    organizationId: string;
    action: string;
    payload: Readonly<Record<string, unknown>>;
  }[] = [];

  public record(
    actor: Principal,
    action: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    this.rows.push({ organizationId: actor.organizationId, action, payload });
    return Promise.resolve();
  }
}
