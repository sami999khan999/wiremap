import type { DocPageDraftDto, DocPageNodeDto, DocSpaceDto } from "../import.js";
import { DocRules } from "./doc.rules.js";
import type { DocPageDraftRecord, DocPageNodeRecord } from "./doc-page.repository.js";
import type { DocSpaceSummary } from "./doc-space.repository.js";

// Records to the wire shapes. Every use-case that returns a page goes through here, so
// `status` is derived in one place and a new column is a one-line change.
export class DocShape {
  private constructor() {}

  public static space(space: DocSpaceSummary): DocSpaceDto {
    return {
      id: space.id,
      slug: space.slug,
      title: space.title,
      description: space.description,
      icon: space.icon,
      audience: space.audience,
      theme: space.theme,
      position: space.position,
      createdBy: space.createdBy,
      version: space.version,
      updatedAt: space.updatedAt,
    };
  }

  public static node(node: DocPageNodeRecord): DocPageNodeDto {
    return {
      id: node.id,
      spaceId: node.spaceId,
      parentId: node.parentId,
      kind: node.kind,
      slug: node.slug,
      title: node.title,
      icon: node.icon,
      position: node.position,
      status: DocRules.status(node),
      updatedAt: node.updatedAt,
    };
  }

  public static draft(page: DocPageDraftRecord): DocPageDraftDto {
    return {
      ...DocShape.node(page),
      description: page.description,
      markdown: page.markdown,
      url: page.url,
      draftVersion: page.draftVersion,
      revisionNo: page.revisionNo,
      publishedAt: page.publishedAt,
    };
  }
}
