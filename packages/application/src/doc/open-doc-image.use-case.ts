import { type DocSpaceId, NotFoundError, type OrganizationId } from "../import.js";
import type { PlatformReader } from "../platform/index.js";
import type { StorageGateway } from "../port/index.js";
import type { Principal } from "../primitive/index.js";
import type { DocAccess } from "./doc-access.js";
import { DocImageKey } from "./doc-image-key.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";

export interface OpenDocImageInput {
  readonly organizationId: OrganizationId;
  readonly spaceId: DocSpaceId;
  // The URL's last two segments, as typed. Checked here, because the route is not
  // allowed to know what makes a file name valid.
  readonly extension: string;
  readonly id: string;
}

export interface OpenedDocImage {
  readonly url: string;
  // Whether anyone may be handed the same redirect, which is what a shared cache needs.
  readonly public: boolean;
}

// An image in a page, for whoever may read that page: the same audience rules, then a
// short-lived signed URL. Placed at the image's organization's node by the caller.
export class OpenDocImageUseCase {
  // Longer than the redirect is cached for, so a cached redirect never points at a URL
  // that has already expired.
  private static readonly DOWNLOAD_TTL_SECONDS = 3_600;

  public constructor(
    private readonly platform: PlatformReader,
    private readonly spaces: DocSpaceRepository,
    private readonly access: DocAccess,
    private readonly storage: StorageGateway,
  ) {}

  public async execute(
    viewer: Principal | null,
    input: OpenDocImageInput,
  ): Promise<OpenedDocImage> {
    const file = DocImageKey.fileOf(input.extension, input.id);
    const missing = new NotFoundError("doc.image", input.id);
    if (file === null) throw missing;

    const space = await this.spaces.findById(input.organizationId, input.spaceId);
    if (!space) throw missing;

    // A member reads their own organization's images, whatever the audience. Anyone else
    // only the platform's, and only through the same check its pages use.
    const member =
      viewer !== null &&
      viewer.organizationId === input.organizationId &&
      viewer.can("doc.page.read");
    const platformOrganizationId = await this.platform.organizationId();
    const outsider =
      !member &&
      input.organizationId === platformOrganizationId &&
      (await this.access.canRead(viewer, space, platformOrganizationId));
    if (!member && !outsider) throw missing;

    const url = await this.storage.presignDownload(
      DocImageKey.key(input.organizationId, input.spaceId, file),
      OpenDocImageUseCase.DOWNLOAD_TTL_SECONDS,
    );
    return { url, public: space.audience === "public" };
  }
}
