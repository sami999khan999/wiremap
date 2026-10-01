import { type DocPageId, type DocSpaceId, Identifiers } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import type { DocCache } from "../../src/doc/doc.cache.js";
import type { DocPageRepository, DocStalePageRecord } from "../../src/doc/doc-page.repository.js";
import { DocRerender } from "../../src/doc/doc-rerender.js";
import type { MarkdownRenderer, UnitOfWork } from "../../src/port/index.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const SPACE = Identifiers.docSpaceId.parse("018f8c00-0000-7000-8000-000000000030") as DocSpaceId;
const pageId = (n: number) =>
  Identifiers.docPageId.parse(
    `018f8c00-0000-7000-8000-000000000${String(n).padStart(3, "0")}`,
  ) as DocPageId;

const stalePage = (n: number): DocStalePageRecord => ({
  id: pageId(n),
  spaceId: SPACE,
  title: `Page ${n}`,
  description: null,
  markdown: `# ${n}`,
  revisionNo: 3,
});

// A repository whose stale list shrinks as pages are saved, as the real query does.
const harness = (count: number) => {
  const stale = new Map(Array.from({ length: count }, (_, i) => [pageId(i), stalePage(i)]));
  const saved: { id: DocPageId; version: number }[] = [];
  const sections: { id: DocPageId; first: string | null }[] = [];
  const forgotten: string[] = [];
  const pages = {
    listStale: (_org: unknown, _version: number, limit: number) =>
      Promise.resolve([...stale.values()].slice(0, limit)),
    saveRendering: (_org: unknown, id: DocPageId, rendering: { rendererVersion: number }) => {
      stale.delete(id);
      saved.push({ id, version: rendering.rendererVersion });
      return Promise.resolve();
    },
    saveSections: (
      _org: unknown,
      _space: unknown,
      id: DocPageId,
      rows: readonly { heading: string | null }[],
    ) => {
      sections.push({ id, first: rows[0]?.heading ?? null });
      return Promise.resolve();
    },
  } as unknown as DocPageRepository;
  const renderer = {
    version: 2,
    render: (markdown: string) =>
      Promise.resolve({ html: `<p>${markdown}</p>`, toc: [], sections: [] }),
  } as unknown as MarkdownRenderer;
  const cache = {
    forgetPage: (_org: unknown, id: DocPageId, revisionNo: number) => {
      forgotten.push(`${id}:${revisionNo}`);
      return Promise.resolve();
    },
  } as unknown as DocCache;
  const unitOfWork = { run: <T>(work: () => Promise<T>) => work() } as unknown as UnitOfWork;
  return {
    rerender: new DocRerender(pages, renderer, cache, unitOfWork),
    saved,
    sections,
    forgotten,
  };
};

describe("DocRerender", () => {
  it("renders every stale page across batches at the current version", async () => {
    const { rerender, saved } = harness(120);
    expect(await rerender.run(ORG)).toBe(120);
    expect(saved).toHaveLength(120);
    expect(saved.every((row) => row.version === 2)).toBe(true);
  });

  // The cached HTML is keyed by revision, which a re-render keeps.
  it("writes the title section first and forgets the cached page", async () => {
    const { rerender, sections, forgotten } = harness(1);
    await rerender.run(ORG);
    expect(sections).toEqual([{ id: pageId(0), first: "Page 0" }]);
    expect(forgotten).toEqual([`${pageId(0)}:3`]);
  });

  it("does nothing when every page is current", async () => {
    const { rerender, saved } = harness(0);
    expect(await rerender.run(ORG)).toBe(0);
    expect(saved).toHaveLength(0);
  });
});
