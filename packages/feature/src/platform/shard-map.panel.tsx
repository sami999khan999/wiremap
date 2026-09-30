import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  DataTable,
  DateFormat,
  EmptyState,
  Field,
  Input,
  PlatformMutations,
  PlatformQueries,
  type ShardMovesDto,
  type ShardNodeDto,
  type ShardTenantDto,
  type TableColumn,
  useApiClient,
  useAppQuery,
  useMemo,
  useState,
} from "../import.js";

export interface ShardMapPanelProps {
  // `feature` may not import routing, so the destination arrives as a string. It is
  // `ROUTES.platform.storage`, which is where a tenant is exported and deleted.
  readonly storageHref: string;
  readonly limit?: number;
}

interface NodeRow extends ShardNodeDto {
  readonly id: string;
}

interface TenantRow extends ShardTenantDto {
  readonly id: string;
}

// The lookup is a typed search, so it waits for something a slug could plausibly be
// rather than asking the server about every keystroke.
const LOOKUP_FLOOR = 3;

export function ShardMapPanel({ storageHref, limit = 25 }: ShardMapPanelProps) {
  const { t } = useMessages("platform");
  const describe = useErrorMessage();
  const client = useApiClient();

  const [expanded, setExpanded] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [term, setTerm] = useState("");
  // The tenant whose move is being confirmed. A row click opens it rather than moving,
  // because a move freezes the tenant's writes and a stray click must not do that.
  const [moving, setMoving] = useState<TenantRow | null>(null);
  const move = PlatformMutations.useMoveTenant(client);

  const map = useAppQuery(
    PlatformQueries.shardMap(client, {
      limit,
      offset,
      ...(expanded !== null && { node: expanded }),
    }),
  );

  const trimmed = term.trim();
  const lookup = useAppQuery({
    ...PlatformQueries.tenantLocation(client, trimmed),
    enabled: trimmed.length >= LOOKUP_FLOOR,
  });

  const moves: ShardMovesDto = map.data?.moves ?? "unavailable";

  const nodes = useMemo<readonly NodeRow[]>(() => {
    const items: readonly ShardNodeDto[] = map.data?.nodes ?? [];
    return items.map((row) => ({ ...row, id: String(row.node) }));
  }, [map.data]);

  const tenants = useMemo<readonly TenantRow[]>(() => {
    const items: readonly ShardTenantDto[] = map.data?.tenants ?? [];
    return items.map((row) => ({ ...row, id: row.organizationId }));
  }, [map.data]);

  // The offset belongs to the expanded node, so opening a different one starts at its
  // first page rather than at the page number the previous node happened to be on.
  const show = (node: number) => {
    setOffset(0);
    setMoving(null);
    setExpanded((current) => (current === node ? null : node));
  };

  const confirm = (row: TenantRow) => {
    move.reset();
    setMoving(row);
  };

  const nodeColumns = useMemo<readonly TableColumn<NodeRow>[]>(
    () => [
      { key: "node", header: t("platform.shards.column.node"), cell: (row) => String(row.node) },
      {
        key: "tenants",
        header: t("platform.shards.column.tenants"),
        cell: (row) => String(row.tenants),
      },
      {
        key: "assigned",
        header: t("platform.shards.column.lastAssigned"),
        cell: (row) => DateFormat.day(row.lastAssignedAt),
      },
      {
        key: "moved",
        header: t("platform.shards.column.lastMoved"),
        cell: (row) =>
          row.lastMovedAt ? DateFormat.day(row.lastMovedAt) : t("platform.shards.never"),
      },
      {
        key: "expand",
        header: t("platform.shards.column.actions"),
        cell: (row) => (
          <Button variant="ghost" onClick={() => show(row.node)}>
            {expanded === row.node ? t("platform.shards.collapse") : t("platform.shards.expand")}
          </Button>
        ),
      },
    ],
    [t, expanded],
  );

  const tenantColumns = useMemo<readonly TableColumn<TenantRow>[]>(
    () => [
      {
        key: "organization",
        header: t("platform.shards.column.organization"),
        // The slug beside the name: the slug is what a delete asks to be typed back,
        // and the name is what an operator recognises.
        cell: (row) => `${row.name} (${row.slug})`,
      },
      {
        key: "assigned",
        header: t("platform.shards.column.assigned"),
        cell: (row) => DateFormat.day(row.assignedAt),
      },
      {
        key: "moved",
        header: t("platform.shards.column.lastMoved"),
        cell: (row) => (row.movedAt ? DateFormat.day(row.movedAt) : t("platform.shards.never")),
      },
      {
        key: "overrides",
        header: t("platform.shards.column.overrides"),
        cell: (row) =>
          row.retentionOverrides === 0
            ? t("platform.shards.overrides.default")
            : t("platform.shards.overrides.count", { count: row.retentionOverrides }),
      },
      {
        key: "actions",
        header: t("platform.shards.column.actions"),
        // A link rather than a second delete form. The delete panel asks for the slug
        // to be typed back, and two places to get that confirmation wrong is one too many.
        cell: (row) => (
          <>
            <Button variant="ghost" disabled={moves === "unavailable"} onClick={() => confirm(row)}>
              {t("platform.shards.move")}
            </Button>
            <a href={storageHref}>{t("platform.shards.manage")}</a>
          </>
        ),
      },
    ],
    [t, moves, storageHref],
  );

  // Every node but the one the tenant is on. The map lists them all, so the choice is
  // never a number typed into a field that the server then has to refuse.
  const targets = moving ? nodes.filter((row) => row.node !== moving.node) : [];

  const total = map.data?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);

  return (
    <section>
      <h2>{t("platform.shards.title")}</h2>
      <p>{t("platform.shards.description")}</p>

      {map.isPending ? <DataTable.Skeleton rows={2} columns={5} /> : null}
      {map.isError ? <Callout tone="danger">{describe(map.error)?.message}</Callout> : null}
      {map.isSuccess && nodes.length === 0 ? (
        <EmptyState title={t("platform.shards.empty")} />
      ) : null}
      {nodes.length > 0 ? (
        <DataTable columns={nodeColumns} rows={nodes} caption={t("platform.shards.title")} />
      ) : null}

      {expanded !== null ? (
        <section>
          <h3>{t("platform.shards.tenants.title", { node: expanded })}</h3>
          {map.isSuccess && tenants.length === 0 ? (
            <EmptyState title={t("platform.shards.tenants.empty")} />
          ) : null}
          {tenants.length > 0 ? (
            <DataTable
              columns={tenantColumns}
              rows={tenants}
              caption={t("platform.shards.tenants.title", { node: expanded })}
            />
          ) : null}
          {
            // Disabled rather than hidden at the ends: a control that disappears is one
            // an operator looks for and cannot find.
          }
          <p>
            <Button
              variant="secondary"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              {t("platform.shards.page.previous")}
            </Button>
            <span>{t("platform.shards.page", { from, to, total })}</span>
            <Button
              variant="secondary"
              disabled={to >= total}
              onClick={() => setOffset(offset + limit)}
            >
              {t("platform.shards.page.next")}
            </Button>
          </p>
          {moves === "unavailable" ? (
            <Callout tone="warning">{t("platform.shards.move.unavailable")}</Callout>
          ) : null}
        </section>
      ) : null}

      {moving !== null ? (
        <section>
          <h3>{t("platform.shards.move.title", { name: moving.name })}</h3>
          {
            // Before the buttons: the freeze is the cost of pressing one, and a warning
            // read after the click is a warning nobody read.
          }
          <Callout tone="warning">
            {t("platform.shards.move.warning", { name: moving.name, node: moving.node })}
          </Callout>
          <p>
            {targets.map((target) => (
              <Button
                key={target.id}
                variant="secondary"
                disabled={move.isPending || move.isSuccess}
                onClick={() =>
                  move.mutate({ organizationId: moving.organizationId, toNode: target.node })
                }
              >
                {t("platform.shards.move.to", { node: target.node })}
              </Button>
            ))}
            <Button variant="ghost" onClick={() => setMoving(null)}>
              {t("platform.shards.move.cancel")}
            </Button>
          </p>
          {move.isSuccess ? (
            <Callout tone="success">
              {t("platform.shards.move.queued", { jobId: move.data.jobId })}
            </Callout>
          ) : null}
          {move.isError ? <Callout tone="danger">{describe(move.error)?.message}</Callout> : null}
        </section>
      ) : null}

      <h3>{t("platform.shards.lookup.title")}</h3>
      <Field label={t("platform.shards.lookup.label")} htmlFor="shard-tenant-lookup">
        <Input
          id="shard-tenant-lookup"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
      </Field>
      {lookup.isSuccess && lookup.data.tenant === null ? (
        <p>{t("platform.shards.lookup.empty")}</p>
      ) : null}
      {lookup.isSuccess && lookup.data.tenant ? (
        <Callout tone="success">
          {t("platform.shards.lookup.found", {
            name: lookup.data.tenant.name,
            slug: lookup.data.tenant.slug,
            node: lookup.data.tenant.node,
          })}
        </Callout>
      ) : null}
    </section>
  );
}
