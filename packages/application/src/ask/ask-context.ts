import type { GraphDocument, GraphFile } from "../import.js";
import { GraphIndex } from "../import.js";

export type AskPreset = "file" | "folder" | "route" | "onboarding";

export interface AskGrounding {
  // The graph-derived context, always present.
  readonly overview: string;
  // Files whose contents are worth fetching, most relevant first.
  readonly files: readonly string[];
}

const WORD = /[a-z0-9_$./-]{3,}/g;
const STOP = new Set([
  "the",
  "and",
  "for",
  "what",
  "where",
  "which",
  "how",
  "does",
  "this",
  "that",
  "with",
  "from",
  "into",
  "are",
  "is",
  "why",
  "who",
  "when",
  "file",
  "files",
  "project",
  "code",
]);

// Grounding from the graph alone: files and routes the question names, their neighbours,
// and the project's overview. No embeddings: names are what people ask about.
export class AskContext {
  private constructor() {}

  public static readonly MAX_FILES = 8;
  private static readonly MAX_ROUTES = 80;

  public static ground(
    document: GraphDocument,
    question: string,
    preset: AskPreset | null,
  ): AskGrounding {
    const words = [
      ...new Set((question.toLowerCase().match(WORD) ?? []).filter((word) => !STOP.has(word))),
    ];
    const scored = document.files
      .map((file) => ({ file, score: AskContext.score(file, words) }))
      .filter((entry) => entry.score > 0)
      .toSorted((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
    const index = GraphIndex.from(document);
    let files = scored.map((entry) => entry.file.path);

    // An onboarding summary, or a question naming nothing, reads the spine of the project:
    // what the most others lean on, and where its routes are handled.
    if (preset === "onboarding" || files.length === 0) {
      const routeFiles = [...new Set(document.routes.map((route) => route.file))];
      files = [...document.insights.mostDepended.map((entry) => entry.path), ...routeFiles];
    }
    const picked = [...new Set(files)].slice(0, AskContext.MAX_FILES);

    const lines: string[] = [];
    lines.push(
      `Repositories: ${document.meta.repositories.map((repository) => repository.name).join(", ")}`,
    );
    lines.push(
      `Frameworks: ${[...new Set(document.frameworks.map((framework) => framework.id))].join(", ") || "none detected"}`,
    );
    lines.push(
      `${document.files.length} files, ${document.edges.filter((edge) => edge.kind === "import").length} imports, ${document.routes.length} routes, ${document.insights.cycles.length} cycles, ${document.insights.unguardedRoutes.length} unguarded routes.`,
    );
    if (document.routes.length > 0) {
      lines.push("", "Routes (METHOD path → handler file:line):");
      for (const route of document.routes.slice(0, AskContext.MAX_ROUTES)) {
        const guard =
          route.guards.length > 0 ? ` [guards: ${route.guards.join(", ")}]` : " [no guard]";
        lines.push(`${route.method} ${route.path} → ${route.file}:${route.line}${guard}`);
      }
    }
    if (document.insights.mostDepended.length > 0) {
      lines.push(
        "",
        "Most depended on:",
        ...document.insights.mostDepended
          .slice(0, 5)
          .map((entry) => `${entry.path} (${entry.dependents} importers)`),
      );
    }
    if (picked.length > 0) {
      lines.push("", "Files relevant to the question:");
      for (const path of picked) {
        const file = document.files.find((each) => each.path === path);
        if (!file) continue;
        lines.push(
          `${path} — role ${file.role}, ${file.loc} lines, exports ${file.exports.slice(0, 12).join(", ") || "none"}`,
          `  imports: ${index.imports(path).slice(0, 10).join(", ") || "none"}`,
          `  imported by: ${index.importers(path).slice(0, 10).join(", ") || "none"}`,
        );
      }
    }
    return { overview: lines.join("\n"), files: picked };
  }

  public static system(): string {
    return [
      "You are wiremap's assistant. You answer questions about one codebase, using only the context given: a graph of its files, imports and routes, and the contents of a few files.",
      "Cite every claim about the code as `path:line` (a file and line from the context) or `METHOD /path` (a route). A claim you cannot cite, you do not make.",
      "When the context does not contain the answer, say so plainly and say which file would.",
      "Be concise. Use short paragraphs or lists. Never invent a file, a route or a line.",
    ].join("\n");
  }

  // A file's text with line numbers, which is what makes `path:line` citations possible.
  public static numbered(path: string, text: string, maxLines: number): string {
    const lines = text.split("\n").slice(0, maxLines);
    return [`--- ${path} ---`, ...lines.map((line, index) => `${index + 1}| ${line}`)].join("\n");
  }

  private static score(file: GraphFile, words: readonly string[]): number {
    const path = file.path.toLowerCase();
    const name = path.split("/").pop() ?? path;
    const stem = name
      .replace(/\.[a-z]+$/, "")
      .replace(/\.(controller|service|module|entity|dto|repository|guard|component)$/, "");
    let score = 0;
    for (const word of words) {
      if (path === word || path.endsWith(`/${word}`)) score += 10;
      else if (stem === word) score += 6;
      else if (name.includes(word)) score += 3;
      else if (path.includes(`/${word}/`)) score += 2;
      if (file.exports.some((exported) => exported.toLowerCase() === word)) score += 4;
      if (file.role === word.replace(/s$/, "")) score += 1;
    }
    return score;
  }
}
