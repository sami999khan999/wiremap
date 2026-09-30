// Ambient module declarations are per-program, so `packages/asset/asset.d.ts` does not
// travel to a consumer that imports `@loadbearing/asset/sprite.svg`. This package needs
// its own, named in `tsconfig.json`'s `include` because it sits above `src/`.

declare module "*.svg" {
  const url: string;
  export default url;
}
