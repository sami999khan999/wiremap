import { describe, expect, it } from "vitest";
import { UnifiedMarkdownRenderer } from "../../src/unified/unified-markdown.renderer.js";

const renderer = new UnifiedMarkdownRenderer();

// An author in one tenant writes, every member of it reads. Whatever the renderer lets
// through runs in their browser with their session.
describe("UnifiedMarkdownRenderer — sanitising", () => {
  it.each([
    ["a script tag", "<script>alert(1)</script>"],
    ["an inline handler", '<img src="x" onerror="alert(1)">'],
    ["an iframe", '<iframe src="https://evil.example"></iframe>'],
    ["a style attribute", '<p style="position:fixed">x</p>'],
  ])("drops %s written as raw HTML", async (_name, markdown) => {
    const { html } = await renderer.render(markdown);
    expect(html).not.toMatch(/<script|onerror|<iframe|style=/i);
  });

  it("drops a `javascript:` link and keeps an ordinary one", async () => {
    const { html } = await renderer.render(
      "[bad](javascript:alert(1)) [good](https://example.com)",
    );
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="nofollow noopener noreferrer"');
  });

  it("drops a class hook an author tries to forge in a directive", async () => {
    const { html } = await renderer.render(':::note{class="ui-callout ui-evil"}\ntext\n:::');
    expect(html).not.toContain("ui-evil");
  });
});

describe("UnifiedMarkdownRenderer — blocks", () => {
  it("renders a GitHub alert as the callout markup the UI styles", async () => {
    const { html } = await renderer.render("> [!WARNING]\n> Mind the gap.");
    expect(html).toContain('<div class="ui-callout ui-callout--warning">');
    expect(html).toContain('<div class="ui-callout__body">');
    expect(html).toContain("Mind the gap.");
    expect(html).not.toContain("[!WARNING]");
  });

  it("leaves an ordinary blockquote alone", async () => {
    const { html } = await renderer.render("> Just a quote.");
    expect(html).toContain("<blockquote>");
  });

  it("renders cards, linked and unlinked, and refuses a script URL on one", async () => {
    const { html } = await renderer.render(
      [
        "::::cards",
        ':::card{title="Core" href="/docs/core"}',
        "Handles the **logic**.",
        ":::",
        ':::card{title="Plain"}',
        "No link.",
        ":::",
        ':::card{title="Bad" href="javascript:alert(1)"}',
        "x",
        ":::",
        "::::",
      ].join("\n"),
    );

    expect(html).toContain('<div class="ui-card-grid">');
    expect(html).toContain('<a class="ui-card" href="/docs/core">');
    expect(html).toContain('<span class="ui-card__title">Core</span>');
    expect(html).toContain("<strong>logic</strong>");
    expect(html).toContain('<div class="ui-card"><span class="ui-card__title">Plain</span>');
    expect(html).not.toContain("javascript:");
  });

  it("highlights a fenced block with a known language and leaves an unknown one plain", async () => {
    const { html } = await renderer.render("```ts\nconst a = 1;\n```\n\n```nonsense\nx\n```");
    expect(html).toContain('class="hljs language-ts"');
    expect(html).toContain("hljs-keyword");
    expect(html).toMatch(/language-nonsense">x/);
  });
});

describe("UnifiedMarkdownRenderer — outline", () => {
  const markdown = [
    "Intro text.",
    "",
    "## Install",
    "Run it.",
    "",
    "### On Linux",
    "Use apt.",
    "",
    "## Install",
    "Again.",
  ].join("\n");

  it("lists h2 to h4 with unique ids that match the rendered headings", async () => {
    const { html, toc } = await renderer.render(markdown);
    expect(toc).toEqual([
      { id: "install", text: "Install", depth: 2 },
      { id: "on-linux", text: "On Linux", depth: 3 },
      { id: "install-1", text: "Install", depth: 2 },
    ]);
    for (const entry of toc) expect(html).toContain(`id="${entry.id}"`);
  });

  it("splits the page into one search section per heading, the intro included", async () => {
    const { sections } = await renderer.render(markdown);
    expect(sections).toEqual([
      { anchor: null, heading: null, body: "Intro text." },
      { anchor: "install", heading: "Install", body: "Run it." },
      { anchor: "on-linux", heading: "On Linux", body: "Use apt." },
      { anchor: "install-1", heading: "Install", body: "Again." },
    ]);
  });
});
