import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PasswordInput } from "../../../src/component/password-input/index.js";

const field = () => <PasswordInput id="pw" showLabel="Show password" hideLabel="Hide password" />;

describe("PasswordInput", () => {
  it("hides the value until asked, and says what the button will do", () => {
    const { container } = render(field());
    const input = container.querySelector("input") as HTMLInputElement;

    expect(input.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input.type).toBe("password");
  });

  it("is one input, so the toggle never submits a form or takes the label", () => {
    const { container } = render(field());

    expect(container.querySelectorAll("input")).toHaveLength(1);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });
});
