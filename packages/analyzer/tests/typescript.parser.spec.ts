import { describe, expect, it } from "vitest";
import { TypescriptParser } from "../src/language/index.js";

describe("TypescriptParser", () => {
  it("reads every import form with the names it takes, and every export", () => {
    const parsed = TypescriptParser.parse(
      "a.ts",
      [
        'import def, { a, b as c } from "./x";',
        'import * as ns from "./ns";',
        'import "./side";',
        'export { d } from "./d";',
        'export * from "./all";',
        'const lazy = () => import("./lazy");',
        'const req = require("./req");',
        "export const one = 1, two = 2;",
        "export default class Thing {}",
        "export function fn() {}",
        "export type T = string;",
      ].join("\n"),
    );

    expect(parsed.imports.map((each) => [each.specifier, each.names])).toEqual([
      ["./x", ["default", "a", "b"]],
      ["./ns", ["*"]],
      ["./side", ["*"]],
      ["./d", ["d"]],
      ["./all", ["*"]],
      ["./lazy", ["*"]],
      ["./req", ["*"]],
    ]);
    expect(parsed.exports.toSorted()).toEqual(["d", "default", "fn", "one", "T", "two"].toSorted());
  });
});
