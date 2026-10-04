import { BaseEdge, type EdgeProps, getBezierPath } from "../import.js";
import type { Point } from "./explorer-layout.js";

export interface RouteEdgeData extends Record<string, unknown> {
  // ELK's route, in canvas coordinates. Absent while the instant grid layout stands in.
  readonly points?: readonly Point[] | undefined;
}

const RADIUS = 8;

// An orthogonal route with its corners rounded, so a bend reads as a turn and two lines that
// share a corridor stay two lines.
export function routePath(points: readonly Point[]): string {
  const [first, ...rest] = points;
  if (!first) return "";
  let path = `M ${first.x} ${first.y}`;
  for (let index = 0; index < rest.length; index += 1) {
    const at = rest[index] as Point;
    const before = (index === 0 ? first : rest[index - 1]) as Point;
    const after = rest[index + 1];
    if (!after) {
      path += ` L ${at.x} ${at.y}`;
      break;
    }
    const inLength = Math.hypot(at.x - before.x, at.y - before.y) || 1;
    const outLength = Math.hypot(after.x - at.x, after.y - at.y) || 1;
    const radius = Math.min(RADIUS, inLength / 2, outLength / 2);
    const enterX = at.x - ((at.x - before.x) / inLength) * radius;
    const enterY = at.y - ((at.y - before.y) / inLength) * radius;
    const leaveX = at.x + ((after.x - at.x) / outLength) * radius;
    const leaveY = at.y + ((after.y - at.y) / outLength) * radius;
    path += ` L ${enterX} ${enterY} Q ${at.x} ${at.y} ${leaveX} ${leaveY}`;
  }
  return path;
}

export function RouteEdge(props: EdgeProps) {
  const points = (props.data as RouteEdgeData | undefined)?.points;
  const path =
    points && points.length >= 2
      ? routePath(points)
      : getBezierPath({
          sourceX: props.sourceX,
          sourceY: props.sourceY,
          sourcePosition: props.sourcePosition,
          targetX: props.targetX,
          targetY: props.targetY,
          targetPosition: props.targetPosition,
        })[0];
  return (
    <BaseEdge
      id={props.id}
      path={path}
      {...(props.style ? { style: props.style } : {})}
      {...(props.markerEnd ? { markerEnd: props.markerEnd } : {})}
      interactionWidth={12}
    />
  );
}
