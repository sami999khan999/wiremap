import { MarkdownRenderer, type RenderedMarkdown } from "../import.js";

// Canned: rendered HTML is the unified adapter's to test. `## ` lines still become one
// heading each, so a spec about the outline or the search sections has something to count.
export class StubMarkdownRenderer extends MarkdownRenderer {
  public readonly version = 0;

  public override render(markdown: string): Promise<RenderedMarkdown> {
    const headings = markdown
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).trim());
    return Promise.resolve({
      html: `<pre>${markdown.length}</pre>`,
      toc: headings.map((text, index) => ({ id: `h-${index}`, text, depth: 2 })),
      sections: headings.map((heading, index) => ({ anchor: `h-${index}`, heading, body: "" })),
    });
  }
}
