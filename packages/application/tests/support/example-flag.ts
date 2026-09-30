import { type FlagKey, type FlagMeta, FlagRegistry } from "@loadbearing/permissions";
import { vi } from "vitest";

// Lite declares no flag, so a spec of the flag machinery declares its own through the
// registry, the one place every flag reader asks. Restored by `vi.restoreAllMocks()`.
export const EXAMPLE_FLAG = "example.rollout" as FlagKey;

const META: FlagMeta = { owner: "sami", expiresOn: "2027-03-31", description: "An example" };

export function declareExampleFlag(): void {
  const registry = FlagRegistry.instance;
  const isKnown = (value: string): value is FlagKey => value === EXAMPLE_FLAG;
  vi.spyOn(registry, "all").mockReturnValue([EXAMPLE_FLAG]);
  vi.spyOn(registry, "isKnown").mockImplementation(isKnown);
  vi.spyOn(registry, "meta").mockImplementation((key) => (isKnown(key) ? META : undefined));
}
