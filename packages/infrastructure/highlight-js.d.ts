// Stands in for highlight.js's own types, which carry `reference lib="dom"` and would put
// the DOM's `ReadableStream` over Node's in this whole package. See docs/reference/doc-renderer.md.
export type LanguageFn = (hljs?: unknown) => unknown;
