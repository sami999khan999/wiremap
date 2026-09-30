// What the bundler turns a binary import into: a fingerprinted URL string. Above `src/`
// because it is build tooling rather than shipped code, and named in `tsconfig.json`'s
// `include` for exactly that reason.

declare module "*.svg" {
  const url: string;
  export default url;
}

declare module "*.webp" {
  const url: string;
  export default url;
}

declare module "*.png" {
  const url: string;
  export default url;
}

declare module "*.woff2" {
  const url: string;
  export default url;
}
