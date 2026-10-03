import { ts } from "../import.js";

export interface Decorated {
  readonly name: string;
  readonly args: readonly ts.Expression[];
  readonly node: ts.Decorator;
}

// The handful of tree questions the TypeScript plugins ask, answered once.
export class TsSyntax {
  private constructor() {}

  public static decorators(node: ts.Node): Decorated[] {
    if (!ts.canHaveDecorators(node)) return [];
    return (ts.getDecorators(node) ?? []).flatMap((decorator): Decorated[] => {
      const expression = decorator.expression;
      if (ts.isCallExpression(expression)) {
        const name = TsSyntax.calleeName(expression.expression);
        return name ? [{ name, args: expression.arguments, node: decorator }] : [];
      }
      return ts.isIdentifier(expression)
        ? [{ name: expression.text, args: [], node: decorator }]
        : [];
    });
  }

  // `Get`, `Nest.Get` → `Get`; anything else → null.
  public static calleeName(expression: ts.Expression): string | null {
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    return null;
  }

  // A literal's text, the first of an array of them, or a `path` property of an object.
  public static stringOf(expression: ts.Expression | undefined): string | null {
    if (!expression) return null;
    if (ts.isStringLiteralLike(expression)) return expression.text;
    if (ts.isArrayLiteralExpression(expression)) return TsSyntax.stringOf(expression.elements[0]);
    if (ts.isObjectLiteralExpression(expression))
      return TsSyntax.stringOf(TsSyntax.property(expression, "path"));
    return null;
  }

  public static property(
    object: ts.ObjectLiteralExpression,
    name: string,
  ): ts.Expression | undefined {
    for (const property of object.properties) {
      if (ts.isPropertyAssignment(property) && TsSyntax.nameOf(property.name) === name)
        return property.initializer;
      if (ts.isShorthandPropertyAssignment(property) && property.name.text === name)
        return property.name;
      if (ts.isMethodDeclaration(property) && TsSyntax.nameOf(property.name) === name)
        return undefined;
    }
    return undefined;
  }

  // Every key of an object literal, methods and shorthands included.
  public static keys(object: ts.ObjectLiteralExpression): string[] {
    return object.properties.flatMap((property) => {
      const name = property.name ? TsSyntax.nameOf(property.name) : null;
      return name ? [name] : [];
    });
  }

  public static nameOf(name: ts.PropertyName | ts.DeclarationName): string | null {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name))
      return name.text;
    return null;
  }

  // Identifier names in an expression list: `UseGuards(AuthGuard, RolesGuard)`.
  public static identifiers(args: readonly ts.Expression[]): string[] {
    return args.flatMap((arg) => {
      if (ts.isIdentifier(arg)) return [arg.text];
      if (ts.isCallExpression(arg)) {
        const name = TsSyntax.calleeName(arg.expression);
        const inner = TsSyntax.stringOf(arg.arguments[0]);
        return name ? [inner ? `${name}(${inner})` : name] : [];
      }
      if (ts.isNewExpression(arg)) return [TsSyntax.calleeName(arg.expression) ?? "guard"];
      if (ts.isArrayLiteralExpression(arg)) return TsSyntax.identifiers(arg.elements);
      return [];
    });
  }

  public static lineOf(source: ts.SourceFile, node: ts.Node): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  }

  public static walk(node: ts.Node, visit: (node: ts.Node) => void): void {
    visit(node);
    ts.forEachChild(node, (child) => TsSyntax.walk(child, visit));
  }
}
