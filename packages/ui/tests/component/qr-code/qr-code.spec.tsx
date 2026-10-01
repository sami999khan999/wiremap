import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CodeList } from "../../../src/component/code-list/code-list.js";
import { QrCode } from "../../../src/component/qr-code/qr-code.js";

const TOTP_URI =
  "otpauth://totp/Loadbearing:ada@example.test?secret=JBSWY3DPEHPK3PXP&issuer=Loadbearing";

describe("QrCode", () => {
  // An unlabelled image in the middle of a security flow is unusable, which is why the
  // label is a required prop rather than an optional one.
  it("is an image with the label it was given", () => {
    render(<QrCode value={TOTP_URI} label="Scan this with your authenticator app." />);

    expect(
      screen.getByRole("img", { name: "Scan this with your authenticator app." }),
    ).toBeDefined();
  });

  // Every icon in this design system paints with `currentColor`, and a QR is no
  // exception: set `color` on an ancestor and the code follows the theme.
  it("paints with currentColor so one theme recolours it", () => {
    const { container } = render(<QrCode value={TOTP_URI} label="Scan" />);

    expect(container.querySelector("svg")?.getAttribute("fill")).toBe("currentColor");
  });

  // A square viewBox of one unit per module, so the rendered size is entirely the
  // stylesheet's business and the code stays scannable at any width.
  it("sizes itself in modules, not pixels", () => {
    const { container } = render(<QrCode value={TOTP_URI} label="Scan" />);
    const [, , width, height] = (
      container.querySelector("svg")?.getAttribute("viewBox") ?? ""
    ).split(" ");

    expect(width).toBe(height);
    expect(Number(width)).toBeGreaterThan(20);
  });

  // Verbatim: a re-encoded or trimmed URI scans cleanly into an authenticator app that
  // then generates codes the server rejects.
  it("encodes a longer URI into a larger grid rather than truncating", () => {
    const gridFor = (value: string) => {
      const { container } = render(<QrCode value={value} label="Scan" />);
      return Number((container.querySelector("svg")?.getAttribute("viewBox") ?? "").split(" ")[2]);
    };

    expect(gridFor(`${TOTP_URI}&digits=6&period=30&algorithm=SHA1`)).toBeGreaterThanOrEqual(
      gridFor(TOTP_URI),
    );
  });
});

describe("CodeList", () => {
  it("renders one entry per code, labelled for a screen reader", () => {
    render(<CodeList values={["aaaa-bbbb", "cccc-dddd"]} label="Backup codes" />);

    expect(screen.getByRole("list", { name: "Backup codes" })).toBeDefined();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("marks each value as code, because that is what it is", () => {
    const { container } = render(<CodeList values={["aaaa-bbbb"]} label="Backup codes" />);

    expect(container.querySelector("code")?.textContent).toBe("aaaa-bbbb");
  });
});
