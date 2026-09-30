import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeBlock } from "../../src/code-block/code-block.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CodeBlock", () => {
  it("copies the code and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CodeBlock code="echo hi" language="sh" copyLabel="Copy" copiedLabel="Copied" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });

    expect(writeText).toHaveBeenCalledWith("echo hi");
    expect(screen.getByRole("button", { name: "Copied" })).toBeDefined();
    expect(screen.getByText("sh")).toBeDefined();
  });
});
