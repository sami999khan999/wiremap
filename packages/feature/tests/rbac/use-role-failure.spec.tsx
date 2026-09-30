import { ConflictError, ForbiddenError } from "@loadbearing/errors";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useRoleFailure } from "../../src/rbac/use-role-failure.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";
import { transportError } from "../support/transport-error.js";

// `null` is a real answer — it is what a component gets for a thrown nothing — so it
// renders as a sentinel rather than as an empty element the query cannot find.
const NOTHING = "(null)";

function Probe({ thrown }: { thrown: unknown }) {
  const failureCopy = useRoleFailure();

  return <output>{failureCopy(thrown) ?? NOTHING}</output>;
}

const render = (thrown: unknown) =>
  renderWithFakes(<Probe thrown={thrown} />, capabilitiesWith([]), undefined, ["role"]);

const ESCALATE = "You cannot grant a permission you do not hold yourself.";
const GENERIC_CONFLICT = "Someone else changed this first. Reload and try again.";
const GENERIC_FORBIDDEN = "You do not have permission to do that.";

describe("useRoleFailure", () => {
  it("has nothing to say about a thrown nothing", async () => {
    await render(null);

    expect(screen.getByText(NOTHING)).toBeDefined();
  });

  // The four `CONFLICT` reasons. The catalog's own sentence is wrong about all of them:
  // none of these is "someone else changed this first".
  it.each([
    ["reserved", "That key belongs to a built-in role. Choose another."],
    ["duplicate", "A role with that key already exists here."],
    ["system", "Built-in roles cannot be edited or deleted."],
    ["inUse", "Someone still holds this role. Move them to another role first."],
  ])("renders the %s conflict as its own sentence", async (reason, copy) => {
    await render(new ConflictError("role", reason));

    expect(screen.getByText(copy)).toBeDefined();
    expect(screen.queryByText(GENERIC_CONFLICT)).toBeNull();
  });

  // The guard on the lookup, not a cosmetic case: `reason in CONFLICT_COPY` walks the
  // prototype chain for a plain object, so `toString` used to resolve to a copy key.
  it.each(["renamedSinceThisShipped", "toString"])(
    "falls back to the catalog sentence for the unmapped reason %s",
    async (reason) => {
      await render(new ConflictError("role", reason));

      expect(screen.getByText(GENERIC_CONFLICT)).toBeDefined();
    },
  );

  // A refusal from the middleware means "not you". The escalation sentence would be a
  // lie here: the caller holds none of the three keys, so there is nothing to escalate.
  it.each(["rbac.role.manage", "rbac.permission.grant", "rbac.permission.revoke"])(
    "says plainly that %s is not held, rather than talking about escalation",
    async (permission) => {
      await render(new ForbiddenError(permission));

      expect(screen.getByText(GENERIC_FORBIDDEN)).toBeDefined();
      expect(screen.queryByText(ESCALATE)).toBeNull();
    },
  );

  // The distinction the hook exists for: a `FORBIDDEN` naming anything else came from
  // the grant use-case, so the caller may grant — just not this.
  it("names the escalation when the refusal is about the permission being granted", async () => {
    await render(new ForbiddenError("member.invite"));

    expect(screen.getByText(ESCALATE)).toBeDefined();
    expect(screen.queryByText(GENERIC_FORBIDDEN)).toBeNull();
  });

  // `R.3`'s call site. Over HTTP the component is handed the transport's decode, not an
  // `AppError`, and `context` was exactly what the wire used to drop.
  describe("a refusal that came over the wire", () => {
    it("reads the conflict reason out of the decoded envelope", async () => {
      await render(
        transportError({ code: "CONFLICT", context: { resource: "role", reason: "inUse" } }),
      );

      expect(
        screen.getByText("Someone still holds this role. Move them to another role first."),
      ).toBeDefined();
    });

    it("tells an escalation from a gate refusal with only the envelope to go on", async () => {
      await render(
        transportError({ code: "FORBIDDEN", context: { permission: "member.invite" } }, 403),
      );

      expect(screen.getByText(ESCALATE)).toBeDefined();
    });
  });
});
