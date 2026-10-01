import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("Prose — tabs and card icons", () => {
  const TABS =
    '<div class="ui-tabs"><div class="ui-tabs__panel"><p class="ui-tabs__title">pnpm</p><p>pnpm add</p></div>' +
    '<div class="ui-tabs__panel"><p class="ui-tabs__title">npm</p><p>npm i</p></div></div>';

  // The server writes titled panels; a tablist is built after mount, one panel showing.
  it("turns titled panels into a tablist that moves with the arrow keys", async () => {
    render(<Prose html={TABS} copyLabel="Copy" copiedLabel="Copied" />);
    const pnpm = await screen.findByRole("tab", { name: "pnpm" });
    expect(pnpm.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("npm i").closest("[role=tabpanel]")?.hasAttribute("hidden")).toBe(true);

    fireEvent.keyDown(pnpm, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "npm" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("pnpm add").closest("[role=tabpanel]")?.hasAttribute("hidden")).toBe(
      true,
    );
  });

  it("draws a known card icon and ignores an unknown one", async () => {
    const { container } = render(
      <Prose
        html={
          '<a class="ui-card" data-icon="book" href="/a">A</a><a class="ui-card" data-icon="nope" href="/b">B</a>'
        }
        copyLabel="Copy"
        copiedLabel="Copied"
      />,
    );
    await waitFor(() => expect(container.querySelectorAll(".ui-card__icon")).toHaveLength(1));
  });
});
