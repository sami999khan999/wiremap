import { Uuid } from "../import.js";

export class StorageKey {
  private constructor() {}

  // `<subject>/<yyyy>/<mm>/<uuid>.<ext>`. Date-partitioned because lifecycle rules,
  // cost reports and bulk deletes all work on prefixes.
  public static build(subject: string, originalFilename: string, at: Date): string {
    const year = at.getUTCFullYear();
    const month = String(at.getUTCMonth() + 1).padStart(2, "0");
    return `${subject}/${year}/${month}/${Uuid.v7()}${StorageKey.extensionOf(originalFilename)}`;
  }

  // Never the original filename: path traversal, unicode collisions and length
  // limits are all live problems a UUID solves at once.
  private static extensionOf(filename: string): string {
    const match = /\.([a-z0-9]{1,8})$/i.exec(filename);
    const extension = match?.[1];
    return extension ? `.${extension.toLowerCase()}` : "";
  }
}
