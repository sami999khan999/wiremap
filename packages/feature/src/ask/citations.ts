import type { GraphDocument } from "../import.js";

export type Segment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "cite"; readonly text: string; readonly path: string };

const FILE = /`?([\w@.$\-/]+\.[a-zA-Z]{1,6}):(\d+)(?:-\d+)?`?/g;
const ROUTE = /`?\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\/[\w\-/:{}.$]*)`?/g;

// An answer's `path:line` and `METHOD /path` citations, as links when they name a real
// file or route of this graph. A citation of nothing stays plain text: never a dead link.
export class Citations {
  private constructor() {}

  public static split(text: string, document: GraphDocument): Segment[] {
    const files = new Set(document.files.map((file) => file.path));
    const routes = new Map(document.routes.map((route) => [route.id, route.file]));
    const marks: { start: number; end: number; path: string }[] = [];
    for (const match of text.matchAll(FILE)) {
      const raw = match[1] ?? "";
      const path = files.has(raw) ? raw : [...files].find((each) => each.endsWith(`/${raw}`));
      if (path) marks.push({ start: match.index, end: match.index + match[0].length, path });
    }
    for (const match of text.matchAll(ROUTE)) {
      const path = routes.get(`${match[1]} ${match[2]}`);
      if (path) marks.push({ start: match.index, end: match.index + match[0].length, path });
    }
    marks.sort((a, b) => a.start - b.start);
    const segments: Segment[] = [];
    let at = 0;
    for (const mark of marks) {
      if (mark.start < at) continue;
      if (mark.start > at) segments.push({ kind: "text", text: text.slice(at, mark.start) });
      segments.push({
        kind: "cite",
        text: text.slice(mark.start, mark.end).replaceAll("`", ""),
        path: mark.path,
      });
      at = mark.end;
    }
    if (at < text.length) segments.push({ kind: "text", text: text.slice(at) });
    return segments;
  }
}
