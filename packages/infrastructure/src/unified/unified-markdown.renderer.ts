import {
  type DocTocEntryDto,
  defaultSchema,
  type HastElement,
  type HastNodes,
  type HastRoot,
  hastToString,
  MarkdownRenderer,
  type MdastNodes,
  type MdastRoot,
  type RenderedMarkdown,
  type RenderedSection,
  rehypeHighlight,
  rehypeSanitize,
  rehypeSlug,
  rehypeStringify,
  remarkDirective,
  remarkGfm,
  remarkParse,
  remarkRehype,
  type SanitizeSchema,
  unified,
  visit,
} from "../import.js";

type CalloutTone = "info" | "success" | "warning" | "danger";

// GitHub's five alert kinds onto the four callout tones `packages/ui` draws.
const ALERTS: ReadonlyMap<string, CalloutTone> = new Map([
  ["NOTE", "info"],
  ["IMPORTANT", "info"],
  ["TIP", "success"],
  ["WARNING", "warning"],
  ["CAUTION", "danger"],
]);

const ALERT_MARKER = /^\[!(NOTE|IMPORTANT|TIP|WARNING|CAUTION)\]\s*/;

// Only the class hooks this renderer itself emits survive sanitising. An author who types
// `class="ui-…"` gets nothing: raw HTML never reaches the sanitiser at all.
const UI_CLASS = /^ui-/;
// A card's icon is a sprite name, filled in by `Prose`. Only a name's shape gets through.
const ICON_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["className", UI_CLASS],
      ["dataIcon", ICON_NAME],
    ],
    details: [...(defaultSchema.attributes?.details ?? []), ["className", UI_CLASS]],
    summary: [...(defaultSchema.attributes?.summary ?? []), ["className", UI_CLASS]],
    span: [...(defaultSchema.attributes?.span ?? []), ["className", UI_CLASS]],
    p: [...(defaultSchema.attributes?.p ?? []), ["className", UI_CLASS]],
    // One `className` rule, not two: the sanitiser reads the first, and the default's own
    // for footnote links would shadow ours.
    a: [
      ...(defaultSchema.attributes?.a ?? []).filter(
        (rule) => !Array.isArray(rule) || rule[0] !== "className",
      ),
      ["className", "data-footnote-backref", UI_CLASS],
      ["dataIcon", ICON_NAME],
    ],
  },
};

// The headings a reader navigates by. `h1` is the page title's, drawn outside the body.
const TOC_DEPTHS: ReadonlyMap<string, number> = new Map([
  ["h2", 2],
  ["h3", 3],
  ["h4", 4],
]);

interface DirectiveNode {
  readonly type: "containerDirective" | "leafDirective" | "textDirective";
  readonly name: string;
  readonly attributes?: Readonly<Record<string, string | null | undefined>> | null;
  children: MdastNodes[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

// Markdown to sanitised HTML with unified. Sanitising runs before the slugger and the
// highlighter, so the ids and classes those two add are the only ones that skip it.
export class UnifiedMarkdownRenderer extends MarkdownRenderer {
  // Bump when the HTML changes shape, then run `pnpm doc:rerender`. 2 added tabs, steps,
  // accordions and card icons.
  public readonly version = 2;

  private readonly processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(() => (tree: MdastRoot) => UnifiedMarkdownRenderer.blocks(tree))
    .use(remarkRehype)
    .use(rehypeSanitize, SCHEMA)
    .use(rehypeSlug)
    .use(() => (tree: HastRoot) => UnifiedMarkdownRenderer.links(tree))
    .use(rehypeHighlight, { detect: false })
    .use(rehypeStringify);

  public async render(markdown: string): Promise<RenderedMarkdown> {
    const tree = await this.processor.run(this.processor.parse(markdown));
    return {
      html: this.processor.stringify(tree),
      toc: UnifiedMarkdownRenderer.toc(tree),
      sections: UnifiedMarkdownRenderer.sections(tree),
    };
  }

  // Alerts and cards, turned into the callout and card markup `packages/ui` styles. See
  // packages/ui/docs/reference/docs-primitives.md for the exact shapes.
  private static blocks(tree: MdastRoot): void {
    visit(tree, (node) => {
      if (node.type === "blockquote") {
        UnifiedMarkdownRenderer.alert(node);
        return;
      }
      if (
        node.type === "containerDirective" ||
        node.type === "leafDirective" ||
        node.type === "textDirective"
      ) {
        UnifiedMarkdownRenderer.directive(node);
      }
    });
  }

  private static alert(node: Extract<MdastNodes, { type: "blockquote" }>): void {
    const first = node.children[0];
    if (first?.type !== "paragraph") return;
    const text = first.children[0];
    if (text?.type !== "text") return;

    const match = ALERT_MARKER.exec(text.value);
    const tone = match ? ALERTS.get(match[1] ?? "") : undefined;
    if (!match || !tone) return;

    text.value = text.value.slice(match[0].length);
    if (text.value.length === 0) first.children.shift();
    if (first.children.length === 0) node.children.shift();

    // The body wrapper, so the markup matches the React `Callout` exactly. No title: the
    // words would be English whatever the reader's locale, and the tone already says it.
    node.data = { hName: "div", hProperties: { className: ["ui-callout", `ui-callout--${tone}`] } };
    node.children = [
      {
        type: "blockquote",
        children: node.children,
        data: { hName: "div", hProperties: { className: ["ui-callout__body"] } },
      },
    ];
  }

  // Cards, tabs, steps and accordions; any other directive is put back as typed. Shapes:
  // packages/ui/docs/reference/docs-primitives.md, syntax: docs/reference/doc-renderer.md.
  private static directive(node: DirectiveNode): void {
    if (node.type === "containerDirective" && node.name === "tabs") {
      node.data = { hName: "div", hProperties: { className: ["ui-tabs"] } };
      return;
    }
    // Each panel carries its title, so with no script every tab reads as a titled block.
    if (node.type === "containerDirective" && node.name === "tab") {
      node.data = { hName: "div", hProperties: { className: ["ui-tabs__panel"] } };
      node.children = [
        {
          type: "paragraph",
          children: [{ type: "text", value: node.attributes?.title ?? "" }],
          data: { hName: "p", hProperties: { className: ["ui-tabs__title"] } },
        },
        ...node.children,
      ];
      return;
    }
    // Each `###` heading inside is a numbered step, counted by the stylesheet.
    if (node.type === "containerDirective" && node.name === "steps") {
      node.data = { hName: "div", hProperties: { className: ["ui-steps"] } };
      return;
    }
    if (node.type === "containerDirective" && node.name === "accordion") {
      node.data = { hName: "details", hProperties: { className: ["ui-accordion"] } };
      node.children = [
        {
          type: "paragraph",
          children: [{ type: "text", value: node.attributes?.title ?? "" }],
          data: { hName: "summary", hProperties: { className: ["ui-accordion__summary"] } },
        },
        ...node.children,
      ];
      return;
    }
    if (node.type === "containerDirective" && node.name === "cards") {
      node.data = { hName: "div", hProperties: { className: ["ui-card-grid"] } };
      return;
    }
    if (node.type === "containerDirective" && node.name === "card") {
      const href = node.attributes?.href ?? null;
      const title = node.attributes?.title ?? "";
      const icon = node.attributes?.icon ?? null;
      const safe = href !== null && /^(https?:\/\/|\/|#)/.test(href) ? href : null;
      const card = {
        className: ["ui-card"],
        ...(icon !== null && ICON_NAME.test(icon) ? { dataIcon: icon } : {}),
      };
      node.data = {
        hName: safe === null ? "div" : "a",
        hProperties: safe === null ? card : { ...card, href: safe },
      };
      // Inline content only: a card is a link, and a paragraph inside a `span` is not HTML.
      const phrasing = node.children.flatMap((child) =>
        child.type === "paragraph" ? child.children : [],
      );
      node.children = [
        {
          type: "paragraph",
          children: [{ type: "text", value: title }],
          data: { hName: "span", hProperties: { className: ["ui-card__title"] } },
        },
        {
          type: "paragraph",
          children: phrasing,
          data: { hName: "span", hProperties: { className: ["ui-card__description"] } },
        },
      ];
      return;
    }

    const prefix =
      node.type === "containerDirective" ? ":::" : node.type === "leafDirective" ? "::" : ":";
    node.data = { hName: node.type === "textDirective" ? "span" : "div" };
    node.children = [{ type: "text", value: `${prefix}${node.name}` }, ...node.children];
  }

  // An author's link to somewhere else is not an endorsement this site makes.
  private static links(tree: HastRoot): void {
    visit(tree, "element", (node: HastElement) => {
      const href = node.tagName === "a" ? node.properties.href : undefined;
      if (typeof href === "string" && /^https?:\/\//.test(href)) {
        node.properties.rel = ["nofollow", "noopener", "noreferrer"];
      }
    });
  }

  private static toc(tree: HastRoot): DocTocEntryDto[] {
    const out: DocTocEntryDto[] = [];
    visit(tree, "element", (node: HastElement) => {
      const depth = TOC_DEPTHS.get(node.tagName);
      const id = node.properties.id;
      if (depth !== undefined && typeof id === "string") {
        out.push({ id, text: hastToString(node).trim(), depth });
      }
    });
    return out;
  }

  // Top-level only: a heading nested in a callout still anchors a section, but nothing in
  // a list or a table starts one.
  private static sections(tree: HastRoot): RenderedSection[] {
    const out: RenderedSection[] = [];
    let current: { anchor: string | null; heading: string | null; body: string[] } = {
      anchor: null,
      heading: null,
      body: [],
    };
    const flush = (): void => {
      const body = current.body.join(" ").replace(/\s+/g, " ").trim();
      if (body.length > 0 || current.heading !== null) {
        out.push({ anchor: current.anchor, heading: current.heading, body });
      }
    };

    for (const child of tree.children as HastNodes[]) {
      if (child.type === "element" && TOC_DEPTHS.has(child.tagName)) {
        flush();
        const id = child.properties.id;
        current = {
          anchor: typeof id === "string" ? id : null,
          heading: hastToString(child).trim(),
          body: [],
        };
        continue;
      }
      current.body.push(hastToString(child));
    }
    flush();
    return out;
  }
}
