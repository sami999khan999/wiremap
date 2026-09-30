import type { EmbeddingProvider } from "../port/index.js";

// How the corpus is embedded and searched, decided once by the container from
// `EMBEDDING_PROVIDER`. `lexical` needs no provider and makes no outbound call.
export type SearchMode =
  | { readonly kind: "lexical" }
  | { readonly kind: "semantic"; readonly provider: EmbeddingProvider };
