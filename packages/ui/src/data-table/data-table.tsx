import { cn } from "../class-name/index.js";
import type { ReactNode } from "../import.js";

// `id` is the only field this component knows about: React needs a key and `onRowClick`
// needs something to hand back.
export interface TableRow {
  readonly id: string;
}

export interface TableColumn<TRow extends TableRow> {
  readonly key: string;
  // A node, not a string: the header is copy, and copy comes from the caller.
  readonly header: ReactNode;
  readonly cell: (row: TRow) => ReactNode;
  readonly align?: "start" | "end";
}

export interface DataTableProps<TRow extends TableRow> {
  readonly columns: readonly TableColumn<TRow>[];
  readonly rows: readonly TRow[];
  readonly onRowClick?: (row: TRow) => void;
  readonly caption?: string;
  readonly className?: string;
}

export interface DataTableSkeletonProps {
  readonly rows?: number;
  readonly columns?: number;
}

// Exposed as `DataTable.Skeleton` so a caller reaches for it in the same place. It takes
// a row count, because the pending render has no data to count.
function DataTableSkeleton({ rows = 5, columns = 3 }: DataTableSkeletonProps) {
  return (
    <div className="ui-data-table__skeleton" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, row) => (
        <div className="ui-data-table__skeleton-row" key={row}>
          {Array.from({ length: columns }, (_, column) => (
            // --muted mixed toward --border rather than a grey of its own: right in every theme.
            <span
              className="ui-data-table__skeleton-cell h-(--text-base) animate-pulse rounded-sm bg-[color-mix(in_oklch,var(--muted)_60%,var(--border))] motion-reduce:animate-none"
              key={column}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// The alignment the column declares, read back from the attribute the cell already carries.
const CELL = "border-border border-b px-4 py-3 text-start data-[align=end]:text-end";

function DataTableRoot<TRow extends TableRow>({
  columns,
  rows,
  onRowClick,
  caption,
  className,
}: DataTableProps<TRow>) {
  return (
    <table
      className={cn(
        "ui-data-table w-full border-collapse overflow-hidden rounded-lg border border-border bg-surface text-sm [&_tr:last-child_td]:border-b-0",
        className,
      )}
    >
      {caption ? (
        <caption className="ui-data-table__caption px-4 py-3 text-start text-fg-muted text-xs">
          {caption}
        </caption>
      ) : null}
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              data-align={column.align ?? "start"}
              className={cn(
                CELL,
                "bg-muted font-semibold text-fg-muted text-xs uppercase tracking-[0.02em]",
              )}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            className={
              onRowClick ? "ui-data-table__row--clickable cursor-pointer hover:bg-muted" : undefined
            }
            // A clickable row is a control: without these three attributes the
            // interaction exists only for a mouse.
            tabIndex={onRowClick ? 0 : undefined}
            role={onRowClick ? "button" : undefined}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            onKeyDown={
              onRowClick
                ? (event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onRowClick(row);
                  }
                : undefined
            }
          >
            {columns.map((column) => (
              <td key={column.key} data-align={column.align ?? "start"} className={CELL}>
                {column.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// `Object.assign` rather than a mutation, so the compound type is inferred rather than
// declared twice.
export const DataTable = Object.assign(DataTableRoot, { Skeleton: DataTableSkeleton });
