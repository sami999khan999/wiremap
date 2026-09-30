// Ambient module declarations are per-program, so `packages/asset/asset.d.ts` does not
// travel to a consumer that imports a binary through `@loadbearing/ui`. Above `src/`
// because it emits nothing, and named in `tsconfig.json`'s `include` for that reason.

declare module "*.svg" {
  const url: string;
  export default url;
}

declare module "*.css";
