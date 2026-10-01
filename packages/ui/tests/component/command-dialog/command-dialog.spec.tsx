import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CommandDialog,
  type CommandGroup,
  type RenderCommandLink,
} from "../../../src/component/command-dialog/command-dialog.js";
import { SearchTrigger } from "../../../src/component/command-dialog/search-trigger.js";
import { useHotkey } from "../../../src/component/command-dialog/use-hotkey.js";

const GROUPS: readonly CommandGroup[] = [
  {
    key: "docs",
    label: "Docs",
    items: [
      { id: "a", title: "Install", excerpt: "pnpm add", href: "/install" },
      { id: "b", title: "Deploy", href: "/deploy" },
    ],
  },
];

const mount = (groups: readonly CommandGroup[] = GROUPS) => {
  const onOpenChange = vi.fn();
  const followed = vi.fn();
  const renderLink: RenderCommandLink = (item, content, attributes) => (
    <a
      href={item.href}
      {...attributes}
      onClick={(event) => {
        event.preventDefault();
        followed(item.href);
      }}
    >
      {content}
    </a>
  );
  render(
    <CommandDialog
      label="Search"
      open
      onOpenChange={onOpenChange}
      query="de"
      onQueryChange={() => {}}
      placeholder="Search docs"
      emptyLabel="No results"
      groups={groups}
      renderLink={renderLink}
    />,
  );
  return { onOpenChange, followed };
};

const options = () => screen.getAllByRole("option", { hidden: true });

describe("CommandDialog", () => {
  it("lists results under their group with the first one active", () => {
    mount();
    expect(screen.getByRole("group", { name: "Docs", hidden: true })).toBeDefined();
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
  });

  // Through the caller's own link, so its router does the navigating.
  it("follows the active result's link on Enter, and closes", () => {
    const { onOpenChange, followed } = mount();
    const input = screen.getByRole("combobox", { hidden: true });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(followed).toHaveBeenCalledWith("/deploy");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("wraps from the first result to the last", () => {
    mount();
    fireEvent.keyDown(screen.getByRole("combobox", { hidden: true }), { key: "ArrowUp" });
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
  });

  // Base UI's, not ours: Escape asks the caller to close, which owns `open`.
  it("asks to close on Escape", () => {
    const { onOpenChange } = mount();
    fireEvent.keyDown(screen.getByRole("combobox", { hidden: true }), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says so when a query finds nothing", () => {
    mount([]);
    expect(screen.getByText("No results")).toBeDefined();
  });
});

function Harness({ onFire }: { readonly onFire: () => void }) {
  useHotkey("k", onFire, { mod: true });
  return null;
}

describe("useHotkey", () => {
  it("fires on Ctrl and on Cmd, and not on the bare key", () => {
    const onFire = vi.fn();
    render(<Harness onFire={onFire} />);

    fireEvent.keyDown(document, { key: "k" });
    expect(onFire).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.keyDown(document, { key: "K", metaKey: true });
    expect(onFire).toHaveBeenCalledTimes(2);
  });
});

describe("SearchTrigger", () => {
  it("draws each key as its own cap, outside the accessible name", () => {
    const onClick = vi.fn();
    render(<SearchTrigger label="Search" shortcut="Ctrl K" onClick={onClick} />);

    const button = screen.getByRole("button", { name: "Search" });
    expect(button.querySelectorAll("kbd")).toHaveLength(2);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalled();
  });
});
