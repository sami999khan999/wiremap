import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Callout } from "../../../src/component/callout/callout.js";

describe("Callout", () => {
  it("defaults to the informational tone", () => {
    render(<Callout>Check your inbox.</Callout>);

    expect(screen.getByText("Check your inbox.").closest(".ui-callout")?.className).toContain(
      "ui-callout--info",
    );
  });

  it("names tones by meaning, not colour", () => {
    render(<Callout tone="danger">That link has expired.</Callout>);

    expect(screen.getByRole("alert").className).toContain("ui-callout--danger");
  });

  // `status` and not `alert` for the calm tones: an assertive live region cuts a screen
  // reader off mid-sentence.
  it("announces politely unless something actually went wrong", () => {
    render(<Callout tone="success">Your password is saved.</Callout>);

    expect(screen.getByRole("status")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("announces assertively when it did", () => {
    render(<Callout tone="danger">That code was not right.</Callout>);

    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("renders a title above the body when it is given one", () => {
    render(
      <Callout tone="warning" title="Backup codes">
        Save these somewhere safe.
      </Callout>,
    );

    expect(screen.getByText("Backup codes").className).toBe("ui-callout__title");
    expect(screen.getByText("Save these somewhere safe.").className).toBe("ui-callout__body");
  });
});
