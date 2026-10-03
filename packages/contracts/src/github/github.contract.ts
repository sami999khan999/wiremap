import { z } from "../import.js";

export class GithubContract {
  private constructor() {}

  // One GitHub App installation bound to this organization.
  public static readonly installation = z.object({
    installationId: z.number().int().positive(),
    accountLogin: z.string().min(1),
    suspended: z.boolean(),
  });

  // What the "connect GitHub" panel needs: where to send the person, and what is bound.
  // `installUrl` is null when this deployment has no GitHub App configured.
  public static readonly status = z.object({
    installUrl: z.string().nullable(),
    installations: z.array(GithubContract.installation).readonly(),
  });
}

export type GithubInstallationDto = z.infer<typeof GithubContract.installation>;
export type GithubStatusDto = z.infer<typeof GithubContract.status>;
