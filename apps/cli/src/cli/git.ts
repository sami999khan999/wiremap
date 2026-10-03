import { execFile, promisify } from "../import.js";

const run = promisify(execFile);

// A shallow clone of one branch, with the token in the URL for the clone only. Git's own
// error text can carry the URL, so a failure is reported by repository name alone.
export class Git {
  private constructor() {}

  public static async clone(
    fullName: string,
    ref: string,
    token: string,
    into: string,
  ): Promise<string> {
    const url = `https://x-access-token:${token}@github.com/${fullName}.git`;
    try {
      await run(
        "git",
        ["clone", "--depth", "1", "--single-branch", "--branch", ref, "--quiet", url, into],
        {
          timeout: 10 * 60_000,
        },
      );
      const { stdout } = await run("git", ["-C", into, "rev-parse", "HEAD"]);
      return stdout.trim();
    } catch {
      throw new Error(`Could not clone ${fullName} at ${ref}.`);
    }
  }
}
