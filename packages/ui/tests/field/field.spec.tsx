import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field } from "../../src/field/field.js";
import { Input } from "../../src/input/input.js";

describe("Field", () => {
  it("ties the label to the control", () => {
    render(
      <Field label="Email" htmlFor="email">
        <Input id="email" />
      </Field>,
    );

    expect(screen.getByLabelText("Email")).toBeDefined();
  });

  // The regression guard: both ids were computed and placed on the paragraphs, and
  // nothing ever pointed the control at either — so a screen reader announced neither.
  it("points the control at its hint", () => {
    render(
      <Field label="Password" htmlFor="password" hint="At least 12 characters.">
        <Input id="password" />
      </Field>,
    );

    const input = screen.getByLabelText("Password");

    expect(input.getAttribute("aria-describedby")).toBe("password-hint");
    expect(document.getElementById("password-hint")?.textContent).toBe("At least 12 characters.");
  });

  it("points the control at both, in reading order", () => {
    render(
      <Field label="Password" htmlFor="password" hint="At least 12." error="Too short.">
        <Input id="password" />
      </Field>,
    );

    expect(screen.getByLabelText("Password").getAttribute("aria-describedby")).toBe(
      "password-hint password-error",
    );
  });

  it("marks the control invalid only when there is an error", () => {
    const { rerender } = render(
      <Field label="Email" htmlFor="email">
        <Input id="email" />
      </Field>,
    );

    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBeNull();

    rerender(
      <Field label="Email" htmlFor="email" error="Not an address.">
        <Input id="email" />
      </Field>,
    );

    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("true");
  });

  // A native `<select>` is a control too — the invite form wraps one, because the design
  // system has no select yet.
  it("associates a control that is not an Input", () => {
    render(
      <Field label="Role" htmlFor="role" error="Pick one.">
        <select id="role">
          <option value="a">A</option>
        </select>
      </Field>,
    );

    const select = screen.getByLabelText("Role");

    expect(select.getAttribute("aria-describedby")).toBe("role-error");
    expect(select.getAttribute("aria-invalid")).toBe("true");
  });

  it("joins a describedby the caller already set rather than replacing it", () => {
    render(
      <Field label="Email" htmlFor="email" hint="Work address.">
        <Input id="email" aria-describedby="email-extra" />
      </Field>,
    );

    expect(screen.getByLabelText("Email").getAttribute("aria-describedby")).toBe(
      "email-extra email-hint",
    );
  });

  it("leaves children alone when there is not exactly one element", () => {
    render(
      <Field label="Range" htmlFor="from" hint="Inclusive.">
        <Input id="from" />
        <Input id="to" />
      </Field>,
    );

    expect(screen.getByLabelText("Range").getAttribute("aria-describedby")).toBeNull();
  });

  it("adds nothing when there is neither a hint nor an error", () => {
    render(
      <Field label="Email" htmlFor="email">
        <Input id="email" />
      </Field>,
    );

    expect(screen.getByLabelText("Email").getAttribute("aria-describedby")).toBeNull();
  });
});
