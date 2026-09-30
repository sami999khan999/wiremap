import { ForbiddenError, ValidationError } from "@loadbearing/errors";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useApiKeyFailure } from "../../src/apikey/use-api-key-failure.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";
import { transportError } from "../support/transport-error.js";

// `null` is a real answer — it is what a component gets for a thrown nothing — so it
// renders as a sentinel rather than as an empty element the query cannot find.
const NOTHING = "(null)";

function Probe({ thrown }: { thrown: unknown }) {
  const failureCopy = useApiKeyFailure();

  return <output>{failureCopy(thrown) ?? NOTHING}</output>;
}

const render = (thrown: unknown) =>
  renderWithFakes(<Probe thrown={thrown} />, capabilitiesWith([]), undefined, ["apikey"]);

const ESCALATE = "You cannot grant a scope you do not hold yourself.";
const GENERIC_FORBIDDEN = "You do not have permission to do that.";
const GENERIC_UNEXPECTED = "Something went wrong. Please try again.";

describe("useApiKeyFailure", () => {
  it("has nothing to say about a thrown nothing", async () => {
    await render(undefined);

    expect(screen.getByText(NOTHING)).toBeDefined();
  });

  // A refusal from the middleware means "not you". The escalation sentence would be a
  // lie here: the caller holds neither key, so there is no scope to escalate to.
  it.each(["apikey.read", "apikey.manage"])(
    "says plainly that %s is not held, rather than talking about escalation",
    async (permission) => {
      await render(new ForbiddenError(permission));

      expect(screen.getByText(GENERIC_FORBIDDEN)).toBeDefined();
      expect(screen.queryByText(ESCALATE)).toBeNull();
    },
  );

  // The distinction the hook exists for: a `FORBIDDEN` naming anything else came from
  // the use-case, and means "not a scope you hold" rather than "not you".
  it("names the escalation when the refusal is about the scope being asked for", async () => {
    await render(new ForbiddenError("member.invite"));

    expect(screen.getByText(ESCALATE)).toBeDefined();
    expect(screen.queryByText(GENERIC_FORBIDDEN)).toBeNull();
  });

  // Both refusals are one `BAD_REQUEST`, so the field is the only thing telling them
  // apart — which is exactly what `R.3` found the wire dropping.
  it.each([
    ["scopes", "Choose at least one scope the catalog knows."],
    ["expiresAt", "That expiry is already in the past."],
  ])("renders the sentence for the %s field", async (field, copy) => {
    await render(new ValidationError([{ field, rule: "invalid" }]));

    expect(screen.getByText(copy)).toBeDefined();
  });

  // `fields[0]`, not a search: a recognised field further down the list is not the one
  // the form is pointing at, and the hook says so by falling back.
  it("reads the first violation, not whichever one it recognises", async () => {
    await render(
      new ValidationError([
        { field: "name", rule: "tooShort", params: { min: 3 } },
        { field: "scopes", rule: "invalid" },
      ]),
    );

    expect(screen.getByText(GENERIC_UNEXPECTED)).toBeDefined();
    expect(screen.queryByText("Choose at least one scope the catalog knows.")).toBeNull();
  });

  it("falls back to the catalog sentence for a validation failure it does not own", async () => {
    await render(new ValidationError([{ field: "name", rule: "required" }]));

    expect(screen.getByText(GENERIC_UNEXPECTED)).toBeDefined();
  });

  // `R.3`'s call site. Over HTTP the component is handed the transport's decode, not an
  // `AppError`, and `context` and `fields` were both what the wire used to drop.
  describe("a refusal that came over the wire", () => {
    it("tells an escalation from a gate refusal with only the envelope to go on", async () => {
      await render(
        transportError({ code: "FORBIDDEN", context: { permission: "member.invite" } }, 403),
      );

      expect(screen.getByText(ESCALATE)).toBeDefined();
    });

    it("reads the field out of the decoded envelope", async () => {
      await render(
        transportError(
          {
            code: "BAD_REQUEST",
            context: { fieldCount: 1 },
            fields: [{ field: "expiresAt", rule: "past" }],
          },
          400,
        ),
      );

      expect(screen.getByText("That expiry is already in the past.")).toBeDefined();
    });
  });
});
