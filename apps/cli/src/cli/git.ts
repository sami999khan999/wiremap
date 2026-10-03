import { execFile, promisify } from "../import.js";

const run = promisify(execFile);

// A shallow clone of one branch. The token goes in as a header through git's environment,
// so it is in no command line `ps` shows and in no `.git/config` the clone writes.
export class Git {
  private constructor() {}

  public static async clone(
    fullName: string,
    ref: string,
    token: string,
    into: string,
    inherited: Readonly<Record<string, string | undefined>> = {},
  ): Promise<string> {
    const url = `https://github.com/${fullName}.git`;
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    try {
      await run(
        "git",
        ["clone", "--depth", "1", "--single-branch", "--branch", ref, "--quiet", url, into],
        {
          timeout: 10 * 60_000,
          env: {
            ...inherited,
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
            GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
            GIT_TERMINAL_PROMPT: "0",
          },
        },
      );
      const { stdout } = await run("git", ["-C", into, "rev-parse", "HEAD"]);
      return stdout.trim();
    } catch {
      throw new Error(`Could not clone ${fullName} at ${ref}.`);
    }
  }
}
