import type { DocTocEntryDto } from "../import.js";

// One heading's worth of a page, as the search index holds it. The text before the first
// heading has neither an anchor nor a heading.
export interface RenderedSection {
  readonly anchor: string | null;
  readonly heading: string | null;
  readonly body: string;
}

export interface RenderedMarkdown {
  // Sanitised. It is written by one tenant's author and read by every other member, so
  // it is safe to put in a page as it stands, and nothing downstream sanitises it again.
  readonly html: string;
  readonly toc: readonly DocTocEntryDto[];
  readonly sections: readonly RenderedSection[];
}

// Markdown to a page, run once when a page is published and never when it is read. A
// port because the parser is a node-only dependency the domain must not name.
export abstract class MarkdownRenderer {
  // Stored beside every page it rendered, so a change to the markup can find the pages
  // rendered by an older one and render them again.
  public abstract readonly version: number;

  public abstract render(markdown: string): Promise<RenderedMarkdown>;
}
