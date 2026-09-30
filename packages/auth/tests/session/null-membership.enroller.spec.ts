import { describe, expect, it } from "vitest";
import { MembershipEnroller } from "../../src/session/membership.enroller.js";
import { NullMembershipEnroller } from "../../src/session/null-membership.enroller.js";

const USER = "0199a0f0-0000-7000-8000-000000000001" as never;

describe("NullMembershipEnroller", () => {
  // The `invite` enrolment mode. Null is the whole contract: `MembershipReader` turns it
  // into a refused session, so this is what fail-closed looks like at its narrowest.
  it("enrols nobody", async () => {
    expect(await new NullMembershipEnroller().enrol(USER)).toBeNull();
  });

  // Pins the answer against a future "helpful" default: inventing a tenant here hands
  // every anonymous sign-up a working session, unnoticed.
  it("says so on every call, not only the first", async () => {
    const enroller = new NullMembershipEnroller();

    expect(await enroller.enrol(USER)).toBeNull();
    expect(await enroller.enrol(USER)).toBeNull();
  });

  // The binding in `Container` is by type, so this is what catches a port whose
  // signature drifted out from under the one implementation that carries no database.
  it("is a MembershipEnroller", () => {
    expect(new NullMembershipEnroller()).toBeInstanceOf(MembershipEnroller);
  });
});
