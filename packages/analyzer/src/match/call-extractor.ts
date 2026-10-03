import { type HttpMethod, ts } from "../import.js";
import type { ParsedFile } from "../model/index.js";
import { TsSyntax } from "../plugin/index.js";

export interface FoundCall {
  readonly line: number;
  readonly method: HttpMethod;
  // Normalised: placeholders are `:param`, origin and query string gone.
  readonly url: string;
  // False when any part of the URL was a variable: the match is then a guess.
  readonly literal: boolean;
  // A leading variable (`${API}/users`) was dropped as a base URL.
  readonly based: boolean;
}

const VERB_METHODS: Readonly<Record<string, HttpMethod>> = {
  get: "GET",
  post: "POST",
  put: "PUT",
  patch: "PATCH",
  delete: "DELETE",
  head: "HEAD",
  options: "OPTIONS",
};
// Receivers whose `.get(url)` is an HTTP call: the libraries themselves, and names a client
// made with `axios.create` or `ky.create` is conventionally given.
const CLIENTS =
  /^(axios|ky|ofetch|\$fetch|api|http|client|request|instance|httpClient|apiClient|fetcher)$/i;
const DIRECT = new Set(["fetch", "$fetch", "ofetch", "ky", "axios"]);

// `fetch`, `axios`, `ky`, `ofetch` calls whose first argument is a URL that can be read.
export class CallExtractor {
  private constructor() {}

  public static extract(file: ParsedFile): FoundCall[] {
    const source = file.typescript;
    if (!source || !/fetch|axios|ky|\.(get|post|put|patch|delete)\(/.test(file.text)) return [];
    const created = CallExtractor.createdClients(source);
    const calls: FoundCall[] = [];
    TsSyntax.walk(source, (node) => {
      if (!ts.isCallExpression(node) || node.arguments.length === 0) return;
      const callee = node.expression;
      let method: HttpMethod | null = null;
      let base: string | null = null;
      if (ts.isIdentifier(callee) && DIRECT.has(callee.text)) {
        method = CallExtractor.methodOption(node.arguments[1]) ?? "GET";
      } else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
        const receiver = callee.expression.text;
        const verb = VERB_METHODS[callee.name.text];
        if (verb && (CLIENTS.test(receiver) || created.has(receiver))) {
          method = verb;
          base = created.get(receiver) ?? null;
        }
      }
      if (!method) return;
      const first = node.arguments[0] as ts.Expression;
      const url = ts.isObjectLiteralExpression(first) ? TsSyntax.property(first, "url") : first;
      if (ts.isObjectLiteralExpression(first)) method = CallExtractor.methodOption(first) ?? method;
      const read = url ? CallExtractor.urlOf(url) : null;
      if (!read) return;
      const joined =
        base && !/^[a-z]+:\/\//i.test(read.text)
          ? `${base.replace(/\/$/, "")}/${read.text.replace(/^\//, "")}`
          : read.text;
      const normalised = CallExtractor.normalise(joined);
      if (!normalised) return;
      calls.push({
        line: TsSyntax.lineOf(source, node),
        method,
        url: normalised.url,
        literal: read.literal,
        based: normalised.based,
      });
    });
    return calls;
  }

  // `const api = axios.create(...)`, `ky.create`, `ky.extend`, `ofetch.create`, each with the
  // `baseURL` (or `prefixUrl`, `baseURL`) its options name when that is a literal.
  private static createdClients(source: ts.SourceFile): Map<string, string | null> {
    const names = new Map<string, string | null>();
    TsSyntax.walk(source, (node) => {
      if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer)
        return;
      const init = node.initializer;
      if (ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression)) {
        const name = init.expression.name.text;
        if (
          (name === "create" || name === "extend") &&
          /axios|ky|ofetch/.test(init.expression.expression.getText(source))
        ) {
          const options = init.arguments[0];
          const base =
            options && ts.isObjectLiteralExpression(options)
              ? (TsSyntax.stringOf(TsSyntax.property(options, "baseURL")) ??
                TsSyntax.stringOf(TsSyntax.property(options, "prefixUrl")))
              : null;
          names.set(node.name.text, base);
        }
      }
    });
    return names;
  }

  private static methodOption(options: ts.Expression | undefined): HttpMethod | null {
    if (!options || !ts.isObjectLiteralExpression(options)) return null;
    const value = TsSyntax.stringOf(TsSyntax.property(options, "method"))?.toUpperCase();
    return value && ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(value)
      ? (value as HttpMethod)
      : null;
  }

  // A literal, a template, or `"/a/" + id`: variables become `:param`.
  private static urlOf(node: ts.Expression): { text: string; literal: boolean } | null {
    if (ts.isStringLiteralLike(node)) return { text: node.text, literal: true };
    if (ts.isTemplateExpression(node)) {
      const text =
        node.head.text + node.templateSpans.map((span) => `:param${span.literal.text}`).join("");
      return { text, literal: false };
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = CallExtractor.urlOf(node.left) ?? { text: ":param", literal: false };
      const right = CallExtractor.urlOf(node.right) ?? { text: ":param", literal: false };
      return { text: left.text + right.text, literal: left.literal && right.literal };
    }
    return null;
  }

  // Origin and query gone; a leading variable is a base URL, dropped and remembered.
  private static normalise(raw: string): { url: string; based: boolean } | null {
    let url = raw.replace(/^[a-z]+:\/\/[^/]+/i, "").split(/[?#]/)[0] ?? "";
    let based = false;
    if (url.startsWith(":param")) {
      url = url.slice(":param".length);
      based = true;
    }
    if (!url.startsWith("/")) url = `/${url}`;
    url = url.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    // `/` alone after dropping a base says nothing about which route it calls.
    if (url === "/" && based) return null;
    return { url, based };
  }
}
