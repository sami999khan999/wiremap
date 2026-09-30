// What the smoke run is, resolved in `vitest.smoke.config.ts` and in `server.ts`. Here
// rather than beside either, so a spec naming the shape does not import a `globalSetup`.
export interface Smoke {
  readonly databaseUrl: string;
  // Mailpit has no entry in either `env.ts`, because no application code reads it: the
  // apps speak SMTP and this suite is the only thing that ever reads the mailbox back.
  readonly mailpitUrl: string;
}

declare module "vitest" {
  interface ProvidedContext {
    smoke: Smoke;
    // From `globalSetup`, not from the config: the port is one the kernel handed out
    // at boot, so nothing before that can name it.
    baseUrl: string;
  }
}
