// The one file in the CLI that reads the environment; everything else is handed `CliEnv`.
export interface CliEnv {
  readonly server: string | null;
  readonly apiKey: string | null;
  // Where the profile lives: `$XDG_CONFIG_HOME`, `%APPDATA%`, or `~/.config`.
  readonly configHome: string | null;
}

export class Env {
  private constructor() {}

  public static read(): CliEnv {
    const env = process.env;
    const home = env.HOME ?? env.USERPROFILE ?? null;
    return {
      server: env.WIREMAP_SERVER || null,
      apiKey: env.WIREMAP_API_KEY || null,
      configHome: env.XDG_CONFIG_HOME || env.APPDATA || (home ? `${home}/.config` : null),
    };
  }
}
