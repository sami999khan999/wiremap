import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataTable, type TableColumn } from "../../../src/component/data-table/data-table.js";

interface Row {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

const ROWS: readonly Row[] = [
  { id: "a", name: "First", count: 1 },
  { id: "b", name: "Second", count: 2 },
];

const COLUMNS: readonly TableColumn<Row>[] = [
  { key: "name", header: "Name", cell: (row) => row.name },
  { key: "count", header: "Count", cell: (row) => row.count, align: "end" },
];

describe("DataTable", () => {
  it("renders a header per column and a row per record", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} />);

    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("knows nothing about a row beyond its id", () => {
    // The only field this component reads. Everything else goes through `cell`, which
    // is what keeps `DataTable` in `ui` and `TaskTable` in `feature`.
    render(<DataTable columns={COLUMNS} rows={ROWS} />);

    expect(screen.getByText("Second")).toBeDefined();
  });

  it("is not interactive without onRowClick", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("makes a clickable row keyboard-operable", () => {
    // A row that responds to a mouse and not to Enter is the most common accessibility
    // bug in a data table, so the three attributes move together or not at all.
    const onRowClick = vi.fn();
    render(<DataTable columns={COLUMNS} rows={ROWS} onRowClick={onRowClick} />);

    const rows = screen.getAllByRole("button");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute("tabindex")).toBe("0");
  });

  it("hands the whole row back, not an index", () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={COLUMNS} rows={ROWS} onRowClick={onRowClick} />);

    screen.getAllByRole("button")[1]?.click();

    expect(onRowClick).toHaveBeenCalledWith(ROWS[1]);
  });

  it("renders a caption when given one", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} caption="Two things" />);

    expect(screen.getByText("Two things")).toBeDefined();
  });

  it("renders nothing but headers for an empty row set", () => {
    // Not an empty state: that is `EmptyState`'s job, and a table deciding for itself
    // when to stop being a table is a component with an opinion about content.
    render(<DataTable columns={COLUMNS} rows={[]} />);

    expect(screen.getAllByRole("row")).toHaveLength(1);
  });
});

describe("DataTable.Skeleton", () => {
  it("announces itself as busy", () => {
    const { container } = render(<DataTable.Skeleton />);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("takes a row count, because a pending render has no data to count", () => {
    const { container } = render(<DataTable.Skeleton rows={3} columns={4} />);

    expect(container.querySelectorAll(".ui-data-table__skeleton-row")).toHaveLength(3);
    expect(container.querySelectorAll(".ui-data-table__skeleton-cell")).toHaveLength(12);
  });
});
