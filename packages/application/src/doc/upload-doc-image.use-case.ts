import {
  type DocImageUploadDto,
  NotFoundError,
  type UploadDocImageInput,
  Uuid,
} from "../import.js";
import type { StorageGateway } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { DocImageKey } from "./doc-image-key.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";

// Signs one direct upload into the space's own prefix. The browser sends the bytes to
// storage; this use-case only decides who may, what type, and how large.
export class UploadDocImageUseCase {
  // Long enough to pick a file and send it on a slow line; short enough that a leaked URL
  // is useless by the time anybody finds it.
  private static readonly UPLOAD_TTL_SECONDS = 300;

  public constructor(
    private readonly authorizer: Authorizer,
    private readonly spaces: DocSpaceRepository,
    private readonly storage: StorageGateway,
  ) {}

  public async execute(actor: Principal, input: UploadDocImageInput): Promise<DocImageUploadDto> {
    this.authorizer.assert(actor, "doc.page.write");
    const space = await this.spaces.findById(actor.organizationId, input.spaceId);
    if (!space) throw new NotFoundError("doc.space", input.spaceId);

    const file = DocImageKey.file(Uuid.v7(), input.contentType);
    const uploadUrl = await this.storage.presignUpload(
      DocImageKey.key(actor.organizationId, input.spaceId, file),
      input.contentType,
      UploadDocImageUseCase.UPLOAD_TTL_SECONDS,
    );
    return { uploadUrl, url: DocImageKey.url(actor.organizationId, input.spaceId, file) };
  }
}
