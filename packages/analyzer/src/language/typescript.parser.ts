import { ts } from "../import.js";
import type { ImportRef } from "../model/index.js";

export interface TypescriptParse {
  readonly ast: ts.SourceFile;
  readonly imports: readonly ImportRef[];
  readonly exports: readonly string[];
}

// Imports and exports from one file's syntax tree. No type checker: a tree is enough for
// both, and it is what keeps a 5,000-file repository inside a CI minute.
export class TypescriptParser {
  private constructor() {}

  public static parse(path: string, text: string): TypescriptParse {
    const ast = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      TypescriptParser.kindOf(path),
    );
    const imports: ImportRef[] = [];
    const exports = new Set<string>();
    const lineOf = (node: ts.Node) =>
      ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
    const add = (specifier: ts.Expression | undefined, names: string[], node: ts.Node) => {
      if (specifier && ts.isStringLiteralLike(specifier)) {
        imports.push({ specifier: specifier.text, names, line: lineOf(node) });
      }
    };

    for (const statement of ast.statements) {
      if (ts.isImportDeclaration(statement)) {
        add(
          statement.moduleSpecifier,
          TypescriptParser.importedNames(statement.importClause),
          statement,
        );
      } else if (ts.isExportDeclaration(statement)) {
        const clause = statement.exportClause;
        if (statement.moduleSpecifier) {
          const names =
            clause && ts.isNamedExports(clause)
              ? clause.elements.map((element) => (element.propertyName ?? element.name).text)
              : ["*"];
          add(statement.moduleSpecifier, names, statement);
        }
        if (clause && ts.isNamedExports(clause))
          for (const element of clause.elements) exports.add(element.name.text);
        else if (clause && ts.isNamespaceExport(clause)) exports.add(clause.name.text);
      } else if (
        ts.isImportEqualsDeclaration(statement) &&
        ts.isExternalModuleReference(statement.moduleReference)
      ) {
        add(statement.moduleReference.expression, ["*"], statement);
      } else if (ts.isExportAssignment(statement)) {
        exports.add("default");
      } else if (TypescriptParser.isExported(statement)) {
        for (const name of TypescriptParser.declaredNames(statement)) exports.add(name);
      }
    }

    // `require("x")` and `import("x")` anywhere, with a literal: anything else is dynamic and
    // cannot be followed, which the coverage figure then says honestly.
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.arguments.length >= 1) {
        const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
        if (isImport || isRequire) add(node.arguments[0], ["*"], node);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);

    return { ast, imports, exports: [...exports] };
  }

  private static importedNames(clause: ts.ImportClause | undefined): string[] {
    if (!clause) return ["*"];
    const names: string[] = [];
    if (clause.name) names.push("default");
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.push("*");
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements)
        names.push((element.propertyName ?? element.name).text);
    }
    return names.length > 0 ? names : ["*"];
  }

  private static isExported(statement: ts.Statement): boolean {
    return (
      ts.canHaveModifiers(statement) &&
      (ts.getModifiers(statement) ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    );
  }

  private static declaredNames(statement: ts.Statement): string[] {
    const isDefault = (
      ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : []
    ).some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
    if (isDefault) return ["default"];
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.flatMap((declaration) =>
        ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
      );
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name &&
      ts.isIdentifier(statement.name)
    ) {
      return [statement.name.text];
    }
    return [];
  }

  private static kindOf(path: string): ts.ScriptKind {
    if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
    if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
    if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS;
    return ts.ScriptKind.TS;
  }
}
