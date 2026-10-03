// One cycle, drawn: its files on a circle, each pointing at the next. The ring is the
// point; names are listed beside it, so the drawing stays small.
export function CycleRing({ size }: { readonly size: number }) {
  const count = Math.max(1, Math.min(size, 12));
  const radius = 26;
  const points = Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    return { x: 32 + radius * Math.cos(angle), y: 32 + radius * Math.sin(angle) };
  });
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true" className="shrink-0">
      <circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        stroke="var(--warning)"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      {points.map((point, index) => (
        <circle
          key={index}
          cx={point.x}
          cy={point.y}
          r="4"
          fill="var(--surface)"
          stroke="var(--warning)"
          strokeWidth="1.5"
        />
      ))}
    </svg>
  );
}
