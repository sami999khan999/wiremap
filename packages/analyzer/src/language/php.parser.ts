import { createRequire, Language, Parser, type SyntaxNode, type Tree } from "../import.js";
import type { ImportRef } from "../model/index.js";

export interface PhpParse {
  readonly tree: Tree;
  readonly root: SyntaxNode;
  readonly namespace: string | null;
  // Alias → fully qualified name, from every `use` in the file.
  readonly uses: ReadonlyMap<string, string>;
  readonly imports: readonly ImportRef[];
  readonly exports: readonly string[];
}

// PHP through tree-sitter's WASM grammar: no native build, so it runs the same on a laptop
// and in a GitHub Actions runner. `init` once per process; parsing is synchronous after.
export class PhpParser {
  private static parser: Parser | null = null;

  private constructor() {}

  // `grammar` is the path to `tree-sitter-php.wasm`. The CLI ships a copy beside its bundle;
  // in the workspace it resolves from the `tree-sitter-php` package.
  public static async init(grammar?: string): Promise<void> {
    if (PhpParser.parser) return;
    await Parser.init();
    const path =
      grammar ?? createRequire(import.meta.url).resolve("tree-sitter-php/tree-sitter-php.wasm");
    const parser = new Parser();
    parser.setLanguage(await Language.load(path));
    PhpParser.parser = parser;
  }

  public static parse(text: string): PhpParse {
    const parser = PhpParser.parser;
    if (!parser) throw new Error("PhpParser.init() has not run");
    const tree = parser.parse(text) as Tree;
    const root = tree.rootNode;
    let namespace: string | null = null;
    const uses = new Map<string, string>();
    const imports: ImportRef[] = [];
    const exports: string[] = [];
    const line = (node: SyntaxNode) => node.startPosition.row + 1;

    for (const node of PhpParser.descendants(root)) {
      if (node.type === "namespace_definition") {
        namespace = node.childForFieldName("name")?.text ?? namespace;
      } else if (node.type === "namespace_use_declaration") {
        const group = node.children.find((child) => child?.type === "namespace_use_group");
        const prefix = group
          ? (node.children.find(
              (child) => child?.type === "namespace_name" || child?.type === "qualified_name",
            )?.text ?? "")
          : "";
        for (const clause of PhpParser.descendants(node).filter(
          (each) => each.type === "namespace_use_clause",
        )) {
          const named = clause.children.find(
            (child) => child?.type === "qualified_name" || child?.type === "name",
          );
          if (!named) continue;
          const full = PhpParser.trim(prefix ? `${prefix}\\${named.text}` : named.text);
          const alias = clause.childForFieldName("alias")?.text ?? full.split("\\").pop() ?? full;
          uses.set(alias, full);
          imports.push({ specifier: full, names: [alias], line: line(clause) });
        }
      } else if (
        [
          "class_declaration",
          "interface_declaration",
          "trait_declaration",
          "enum_declaration",
        ].includes(node.type)
      ) {
        const name = node.childForFieldName("name")?.text;
        if (name) exports.push(name);
      } else if (
        [
          "require_expression",
          "require_once_expression",
          "include_expression",
          "include_once_expression",
        ].includes(node.type)
      ) {
        const literal = PhpParser.descendants(node).find((each) => each.type === "string_content");
        if (literal)
          imports.push({
            specifier: `./${literal.text.replace(/^\/+/, "")}`,
            names: ["*"],
            line: line(node),
          });
      }
    }

    // Class names used without a `use`: `extends Base` and `new Model` in the same namespace.
    const imported = new Set(imports.map((each) => each.specifier));
    for (const name of PhpParser.referencedClasses(root)) {
      const full = PhpParser.qualify(name.text, namespace, uses);
      if (imported.has(full)) continue;
      imported.add(full);
      imports.push({
        specifier: full,
        names: [full.split("\\").pop() ?? full],
        line: line(name),
        implicit: true,
      });
    }

    return { tree, root, namespace, uses, imports, exports };
  }

  // A name as PHP resolves it: `\X` is absolute, an alias's first segment expands, anything
  // else is relative to the file's namespace.
  public static qualify(
    name: string,
    namespace: string | null,
    uses: ReadonlyMap<string, string>,
  ): string {
    if (name.startsWith("\\")) return PhpParser.trim(name);
    const [first, ...rest] = name.split("\\");
    const alias = first ? uses.get(first) : undefined;
    if (alias) return [alias, ...rest].join("\\");
    return namespace ? `${namespace}\\${name}` : name;
  }

  public static descendants(node: SyntaxNode): SyntaxNode[] {
    const found: SyntaxNode[] = [];
    const stack: SyntaxNode[] = [node];
    while (stack.length > 0) {
      const current = stack.pop() as SyntaxNode;
      found.push(current);
      for (let index = current.namedChildCount - 1; index >= 0; index -= 1) {
        const child = current.namedChild(index);
        if (child) stack.push(child);
      }
    }
    return found;
  }

  // The class names in `extends`, `implements`, `new X`, `X::class` and `X::method()`.
  private static referencedClasses(root: SyntaxNode): SyntaxNode[] {
    const found: SyntaxNode[] = [];
    const builtin = new Set(["self", "static", "parent"]);
    for (const node of PhpParser.descendants(root)) {
      let target: SyntaxNode | null | undefined = null;
      if (node.type === "base_clause" || node.type === "class_interface_clause") {
        for (const child of node.namedChildren)
          if (child && (child.type === "name" || child.type === "qualified_name"))
            found.push(child);
        continue;
      }
      if (node.type === "object_creation_expression")
        target = node.namedChildren.find(
          (child) => child?.type === "name" || child?.type === "qualified_name",
        );
      if (
        node.type === "class_constant_access_expression" ||
        node.type === "scoped_call_expression"
      ) {
        target = node.namedChild(0);
        if (target && target.type !== "name" && target.type !== "qualified_name") target = null;
      }
      if (target && !builtin.has(target.text.toLowerCase())) found.push(target);
    }
    return found;
  }

  private static trim(name: string): string {
    return name.replace(/^\\+/, "");
  }
}
