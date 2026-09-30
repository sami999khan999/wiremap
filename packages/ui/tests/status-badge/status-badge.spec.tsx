import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "../../src/status-badge/status-badge.js";

describe("StatusBadge", () => {
  it("defaults to the neutral tone", () => {
    render(<StatusBadge>Draft</StatusBadge>);

    expect(screen.getByText("Draft").className).toContain("ui-status-badge--neutral");
  });

  it("names tones by meaning, not colour", () => {
    // `danger`, never `red`: a theme that maps danger to something else then changes
    // one custom property instead of every call site.
    render(<StatusBadge tone="danger">Overdue</StatusBadge>);

    expect(screen.getByText("Overdue").className).toContain("ui-status-badge--danger");
  });

  it("keeps a caller's className alongside its own", () => {
    render(<StatusBadge className="mine">Draft</StatusBadge>);
    const badge = screen.getByText("Draft");

    expect(badge.className).toContain("ui-status-badge");
    expect(badge.className).toContain("mine");
  });
});
