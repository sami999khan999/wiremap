export const document = {
  "document.title": "Documents",
  "document.subtitle": "Paste text to index it, then search the corpus by meaning.",
  "document.index.title": "Index text",
  "document.index.text": "Text",
  // The one sentence that prevents a support ticket: the page looks broken otherwise,
  // because a search straight after indexing finds nothing.
  "document.index.hint":
    "Indexing runs in the worker, so a document becomes searchable a moment after you submit it.",
  "document.index.submit": "Index",
  "document.index.queued": "Queued as {documentId}. Search for it in a moment.",
  "document.search.title": "Search",
  "document.search.query": "What are you looking for?",
  "document.search.submit": "Search",
  "document.search.empty": "Nothing matched closely enough.",
  "document.search.score": "Score {score}",
  "document.search.source": "From {sourceId}",
} as const;
