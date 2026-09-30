import type { Linter } from "eslint";

// The six rules Biome cannot express, plus the typed rules that need a whole
// TypeScript program. Hand-written because this package has no build step.
declare const config: Linter.Config[];

export default config;
