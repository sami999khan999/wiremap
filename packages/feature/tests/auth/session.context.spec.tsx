import { CapabilitySet } from "@loadbearing/permissions";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFlags } from "../../src/auth/session.context.js";
import { renderWithFakes } from "../support/render-with-fakes.js";

function FlagProbe() {
  const flags = useFlags();
  return <output>{flags.has("widget.dismissal") ? "on" : "off"}</output>;
}

describe("useFlags", () => {
  it("answers from the session's on-set", async () => {
    await renderWithFakes(
      <FlagProbe />,
      CapabilitySet.empty().toJSON(),
      undefined,
      undefined,
      undefined,
      ["widget.dismissal"],
    );

    expect(screen.getByRole("status").textContent).toBe("on");
  });

  // A provider nobody passed flags to is the state before a rollout starts.
  it("holds no flag when the provider is given none", async () => {
    await renderWithFakes(<FlagProbe />, CapabilitySet.empty().toJSON());

    expect(screen.getByRole("status").textContent).toBe("off");
  });
});
