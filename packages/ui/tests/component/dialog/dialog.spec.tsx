import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AlertDialog, Dialog } from "../../../src/component/dialog/dialog.js";

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe("Dialog", () => {
  it("is named by its title and asks to close on Escape", async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Rename" description="Pick a new name">
        <input aria-label="Name" />
      </Dialog>,
    );
    await settle();

    const dialog = screen.getByRole("dialog", { name: "Rename" });
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("AlertDialog", () => {
  const mount = () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <AlertDialog
        open
        onOpenChange={onOpenChange}
        title="Revoke key?"
        confirmLabel="Revoke"
        cancelLabel="Cancel"
        onConfirm={onConfirm}
      />,
    );
    return { onConfirm, onOpenChange };
  };

  // Enter on arrival must never confirm a destructive action.
  it("starts on Cancel, and confirms only from its own button", async () => {
    const { onConfirm, onOpenChange } = mount();
    await settle();

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" })),
    );
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("cancels without confirming", async () => {
    const { onConfirm, onOpenChange } = mount();
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("is an alertdialog, which a backdrop press does not dismiss", async () => {
    const { onOpenChange } = mount();
    await settle();

    expect(screen.getByRole("alertdialog", { name: "Revoke key?" })).toBeDefined();
    const backdrop = document.querySelector(".ui-dialog__backdrop");
    expect(backdrop).not.toBeNull();
    for (const type of ["pointerDown", "mouseDown", "pointerUp", "mouseUp", "click"] as const) {
      if (backdrop) fireEvent[type](backdrop);
    }
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
