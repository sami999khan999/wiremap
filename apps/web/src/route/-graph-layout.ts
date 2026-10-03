import ELK from "elkjs/lib/elk-api";
import workerUrl from "elkjs/lib/elk-worker.min.js?url";
import type { GraphLayouter } from "~/import.js";

// ELK in a classic web worker, created on first use and only in a browser: a large graph's
// layout runs off the main thread, and the server never builds one.
let elk: InstanceType<typeof ELK> | null = null;

export const elkLayout: GraphLayouter = (graph) => {
  elk ??= new ELK({ workerUrl });
  return elk.layout(graph);
};
