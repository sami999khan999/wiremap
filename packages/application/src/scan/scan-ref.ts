import { Identifiers, type OrganizationId, type ScanId } from "../import.js";
import { ProjectRules } from "../project/index.js";

export interface ScanRef {
  readonly organizationId: OrganizationId;
  readonly scanId: ScanId;
}

// `<organizationId>.<scanId>`: what a runner's URLs and the workflow's one input carry. The
// organization rides along because scans are routed by it.
export class ScanRefs {
  private constructor() {}

  public static format(ref: ScanRef): string {
    return `${ref.organizationId}.${ref.scanId}`;
  }

  public static parse(value: string): ScanRef | null {
    const [organization, scan, ...rest] = value.split(".");
    if (rest.length > 0) return null;
    const organizationId = Identifiers.organizationId.safeParse(organization);
    const scanId = Identifiers.scanId.safeParse(scan);
    return organizationId.success && scanId.success
      ? { organizationId: organizationId.data, scanId: scanId.data }
      : null;
  }

  // Where the gzipped graph lives: under the project's prefix, so deleting a project is
  // one sweep of it.
  public static graphKey(organizationId: string, projectId: string, scanId: string): string {
    return `${ProjectRules.storagePrefix(organizationId, projectId)}${scanId}.json.gz`;
  }
}
