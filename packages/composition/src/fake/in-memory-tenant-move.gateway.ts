import { type OrganizationId, type TableRowCount, TenantMoveGateway } from "../import.js";

// Rows per node per table, as a map rather than as data: a spec about the move asserts
// the counts and the order of the steps, never what a message body said.
type Rows = Map<number, Map<string, number>>;

export type TenantMoveStep = "quiesce" | "prepare" | "copy" | "carry" | "drop";

// The one seam that addresses two nodes, so its fake has to model two. A double that
// reported the same counts on both sides would pass a copy that never ran.
export class InMemoryTenantMoveGateway extends TenantMoveGateway {
  private readonly rows: Rows = new Map();
  private readonly log: { step: TenantMoveStep; organizationId: string; node: number }[] = [];
  private failing: TenantMoveStep | null = null;

  // Seeds what a node holds. Without it every count is zero and a move "verifies"
  // against nothing, which is the failure this fake exists to be able to show.
  public seed(node: number, table: string, rows: number): void {
    const forNode = this.rows.get(node) ?? new Map<string, number>();
    forNode.set(table, rows);
    this.rows.set(node, forNode);
  }

  // The next call to `step` throws, once. What a spec uses to prove the freeze lifts.
  public failAt(step: TenantMoveStep): void {
    this.failing = step;
  }

  public override quiesce(organizationId: OrganizationId, node: number): Promise<void> {
    return this.record("quiesce", organizationId, node);
  }

  // Empties the target, as the real one does: a copy that ran onto a previous attempt's
  // rows would verify against them and pass.
  public override async prepare(
    organizationId: OrganizationId,
    _fromNode: number,
    toNode: number,
  ): Promise<void> {
    await this.record("prepare", organizationId, toNode);
    this.rows.delete(toNode);
  }

  public override async copy(
    organizationId: OrganizationId,
    fromNode: number,
    toNode: number,
  ): Promise<readonly TableRowCount[]> {
    await this.record("copy", organizationId, toNode);

    const source = this.rows.get(fromNode) ?? new Map<string, number>();
    for (const [table, count] of source) this.seed(toNode, table, count);

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
    organizationId: OrganizationId,
    _fromNode: number,
    toNode: number,
  ): Promise<number> {
    await this.record("carry", organizationId, toNode);
    return 0;
  }

  public override async dropOn(
    organizationId: OrganizationId,
    node: number,
  ): Promise<readonly string[]> {
    await this.record("drop", organizationId, node);
    const dropped = [...(this.rows.get(node) ?? new Map<string, number>()).keys()];
    this.rows.delete(node);

    return dropped;
  }

  // In call order, because the order is what a move gets wrong: a copy before the
  // quiesce loses a write, and a copy before the prepare has no partition to land in.
  public steps(): readonly { step: TenantMoveStep; organizationId: string; node: number }[] {
    return this.log;
  }

  private record(step: TenantMoveStep, organizationId: string, node: number): Promise<void> {
    this.log.push({ step, organizationId, node });
    if (this.failing !== step) return Promise.resolve();

    this.failing = null;
    return Promise.reject(new Error(`${step} failed`));
  }
}
