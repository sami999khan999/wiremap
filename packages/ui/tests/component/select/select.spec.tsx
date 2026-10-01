import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Field } from "../../../src/component/field/field.js";
import { Select } from "../../../src/component/select/select.js";

const OPTIONS = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
] as const;

describe("Select", () => {
  // A form reads it through FormData, the way it read the native select it replaced.
  it("carries its value in a hidden input named for the form", () => {
    const { container } = render(
      <form>
        <Select label="Role" name="role" defaultValue="admin" options={OPTIONS} />
      </form>,
    );

    const form = container.querySelector("form");
    expect(form && new FormData(form).get("role")).toBe("admin");
  });

  it("is named after its label and the selected option", () => {
    render(<Select label="Role" value="member" options={OPTIONS} />);
    expect(screen.getByRole("combobox", { name: "Role: Member" })).toBeDefined();
  });

  // Field clones its association onto its one control; the trigger is that control.
  it("takes Field's description and invalid state on the trigger", () => {
    render(
      <Field label="Role" htmlFor="role" hint="Who they are" error="Pick one">
        <Select id="role" label="Role" options={OPTIONS} />
      </Field>,
    );

    const trigger = screen.getByRole("combobox");
    expect(trigger.getAttribute("aria-describedby")).toBe("role-hint role-error");
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("combobox", { name: /Role/ }).id).toBe("role");
  });

  it("reports a choice", async () => {
    const onValueChange = vi.fn();
    render(<Select label="Role" value="member" options={OPTIONS} onValueChange={onValueChange} />);

    fireEvent.click(screen.getByRole("combobox"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.keyDown(document.activeElement ?? document, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement ?? document, { key: "Enter" });

    expect(onValueChange).toHaveBeenCalledWith("admin");
  });
});
