import { describe, expect, it } from "vitest";
import { MessagingRules } from "../../src/messaging/messaging.rules.js";
import { ADA, GRACE, NOW } from "./messaging-harness.js";

describe("MessagingRules", () => {
  // The whole of what makes opening the same DM twice return one conversation. If the
  // two orders disagreed, each person would get their own copy of the same thread.
  it("builds the same direct key whichever way round the pair is given", () => {
    expect(MessagingRules.directKey(ADA, GRACE)).toBe(MessagingRules.directKey(GRACE, ADA));
  });

  it("separates different pairs", () => {
    expect(MessagingRules.directKey(ADA, GRACE)).not.toBe(MessagingRules.directKey(ADA, ADA));
  });

  it("closes the edit window on the far side of it", () => {
    const justInside = new Date(NOW.getTime() + MessagingRules.EDIT_WINDOW_MS);
    const justOutside = new Date(NOW.getTime() + MessagingRules.EDIT_WINDOW_MS + 1);

    expect(MessagingRules.withinEditWindow(NOW, justInside)).toBe(true);
    expect(MessagingRules.withinEditWindow(NOW, justOutside)).toBe(false);
  });
});
