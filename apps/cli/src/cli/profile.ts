import { chmod, mkdir, nodePath, readFile, rm, writeFile } from "../import.js";

export interface StoredProfile {
  readonly server: string;
  readonly apiKey: string;
}

// The server and key `wiremap login` saved. Readable by the user alone: it is a bearer
// credential, and a config folder is often synced or backed up.
export class Profile {
  private constructor() {}

  public static file(configHome: string): string {
    return nodePath.join(configHome, "wiremap", "credentials.json");
  }

  public static async read(configHome: string | null): Promise<StoredProfile | null> {
    if (!configHome) return null;
    try {
      const parsed = JSON.parse(await readFile(Profile.file(configHome), "utf8")) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as StoredProfile).server === "string" &&
        typeof (parsed as StoredProfile).apiKey === "string"
      ) {
        return parsed as StoredProfile;
      }
      return null;
    } catch {
      return null;
    }
  }

  public static async save(configHome: string, profile: StoredProfile): Promise<string> {
    const file = Profile.file(configHome);
    await mkdir(nodePath.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
    // `mode` applies only when the file is created; a second login keeps the first's mode.
    await chmod(file, 0o600);
    return file;
  }

  public static async clear(configHome: string): Promise<boolean> {
    const file = Profile.file(configHome);
    const existed = (await Profile.read(configHome)) !== null;
    await rm(file, { force: true });
    return existed;
  }
}
