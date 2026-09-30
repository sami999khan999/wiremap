import { ApiClient, type AppClient } from "@loadbearing/api-client";
import type { ApiKeyDto } from "@loadbearing/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiKeyList } from "../../src/apikey/api-key.list.js";
import { capabilitiesWith, renderWithFakes, TEST_USER } from "../support/render-with-fakes.js";

const KEY: ApiKeyDto = {
  id: "00000000-0000-7000-8000-0000000000d1" as ApiKeyDto["id"],
  name: "CI deploy",
  prefix: "lb_ci",
  issuerId: TEST_USER.id as ApiKeyDto["issuerId"],
  scopes: ["apikey.read"],
  expiresAt: null,
  revokedAt: null,
  lastUsedAt: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
};

const render = async () => {
  const revoke = vi.fn().mockResolvedValue({ ok: true });
  const client = ApiClient.inProcess({
    apiKey: { list: () => Promise.resolve({ items: [KEY] }), revoke },
  } as unknown as AppClient);
  await renderWithFakes(
    <ApiKeyList />,
    capabilitiesWith(["apikey.read", "apikey.manage"]),
    undefined,
    ["apikey"],
    client,
  );
  return revoke;
};

describe("ApiKeyList — revoke", () => {
  // A dialog in the design system, not `window.confirm`: it takes the theme, and the
  // question names the key it is about.
  it("asks first, and revokes only on the confirm", async () => {
    const revoke = await render();

    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    const question = await screen.findByRole("alertdialog");
    expect(question.textContent).toContain("CI deploy");
    expect(revoke).not.toHaveBeenCalled();

    const confirm = screen
      .getAllByRole("button", { name: "Revoke" })
      .find((button) => question.contains(button));
    if (confirm) fireEvent.click(confirm);

    await waitFor(() => expect(revoke).toHaveBeenCalledWith({ apiKeyId: KEY.id }));
  });

  it("does nothing when the question is cancelled", async () => {
    const revoke = await render();

    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(revoke).not.toHaveBeenCalled();
  });
});
