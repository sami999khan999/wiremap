import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar } from "../../../src/component/avatar/avatar.js";

describe("Avatar", () => {
  it("falls back to initials when there is no image", () => {
    render(<Avatar name="Ada Lovelace" />);

    expect(screen.getByText("AL")).toBeTruthy();
  });

  it("takes two letters from a single word, and a placeholder from nothing", () => {
    expect(Avatar.initials("sami")).toBe("SA");
    expect(Avatar.initials("  ")).toBe("?");
    expect(Avatar.initials("Grace Brewster Hopper")).toBe("GB");
  });
});
