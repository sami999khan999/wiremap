import { encode, useMemo } from "../import.js";

export interface QrCodeProps {
  // The `otpauth://` URI, verbatim. Re-encoding or trimming it produces a QR that
  // scans cleanly into an authenticator app that then generates the wrong codes.
  readonly value: string;
  // Required rather than optional: a QR with no label is an unlabelled image, and this
  // one is the only path through a security flow.
  readonly label: string;
  readonly className?: string;
}

// Real `<rect>` elements rather than `uqr`'s `renderSVG`, which returns a string needing
// `dangerouslySetInnerHTML` — and this way the modules paint with `currentColor`.
export function QrCode({ value, label, className }: QrCodeProps) {
  // Encoding is a real computation and the URI does not change while the panel is open.
  const qr = useMemo(() => encode(value), [value]);

  return (
    <svg
      className={["ui-qr-code", className].filter(Boolean).join(" ")}
      // One unit per module, so the rendered size is entirely the stylesheet's business.
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      role="img"
      aria-label={label}
      // No `fill` on the rects: they inherit this, and this inherits the ancestor.
      fill="currentColor"
      shapeRendering="crispEdges"
    >
      {qr.data.map((row, y) =>
        row.map((filled, x) =>
          filled ? (
            // Coordinates, not indices: the grid is fixed, so position is identity.
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />
          ) : null,
        ),
      )}
    </svg>
  );
}
