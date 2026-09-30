import { z } from "~/import.js";

// Validated so the sign-in page cannot become an open redirect. `//evil.test` and
// `/\evil.test` both resolve with a host — a backslash is a path separator too.
export class RedirectSearch {
  private constructor() {}

  public static readonly schema = z.object({
    redirect: z
      .string()
      .regex(/^\/(?![/\\])[^\\]*$/)
      .optional(),
  });

  public static target(search: { readonly redirect?: string | undefined }): string {
    return search.redirect ?? "/";
  }
}
