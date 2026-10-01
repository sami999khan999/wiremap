import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Prose } from "../../../src/component/prose/prose.js";

const HTML = `<h2 id="setup">Setup</h2><pre><code class="hljs">pnpm i</code></pre>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Prose", () => {
  it("renders the server's HTML as it is", () => {
    render(<Prose html={HTML} copyLabel="Copy" copiedLabel="Copied" />);
    expect(screen.getByRole("heading", { name: "Setup" }).id).toBe("setup");
  });

  // Wired once the browser is idle, not during the first render: a long page has hundreds.
  it("gives every code block one copy button", async () => {
    const { container } = render(<Prose html={HTML} copyLabel="Copy" copiedLabel="Copied" />);
    expect(await screen.findAllByRole("button", { name: "Copy" })).toHaveLength(1);
    expect(container.querySelectorAll(".ui-code-block > pre")).toHaveLength(1);
  });

  it("copies the block's text, not the button's", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<Prose html={HTML} copyLabel="Copy" copiedLabel="Copied" />);

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Copy" }));
    });

    expect(writeText).toHaveBeenCalledWith("pnpm i");
    expect(screen.getByRole("button", { name: "Copied" })).toBeDefined();
  });
});
