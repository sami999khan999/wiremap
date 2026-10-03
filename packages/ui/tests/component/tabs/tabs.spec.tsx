import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Tabs } from "../../../src/component/tabs/tabs.js";

function Harness() {
  const [value, setValue] = useState("overview");
  return (
    <Tabs
      label="Panel"
      value={value}
      onValueChange={setValue}
      items={[
        { value: "overview", label: "Overview" },
        { value: "ask", label: "Ask" },
      ]}
    >
      {(open) => <p>{open === "overview" ? "Routes 21" : "Ask anything"}</p>}
    </Tabs>
  );
}

describe("Tabs", () => {
  it("renders only the open tab's content, and switches on a click", () => {
    render(<Harness />);

    expect(screen.getByText("Routes 21")).toBeTruthy();
    expect(screen.queryByText("Ask anything")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Ask" }));

    expect(screen.getByText("Ask anything")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Ask" }).getAttribute("aria-selected")).toBe("true");
  });

  it("names the tab list", () => {
    render(<Harness />);

    expect(screen.getByRole("tablist", { name: "Panel" })).toBeTruthy();
  });
});
