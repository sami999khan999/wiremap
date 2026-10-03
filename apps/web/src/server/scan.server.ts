import { container } from "./container.js";
import { ScanRefs, SystemPrincipal } from "./import.js";

const STEPS = new Set(["checkout", "upload", "complete", "fail"]);

// The runner protocol: `POST /api/scan/<organization>.<scan>/<step>`, authenticated by the
// scan's own token in `authorization: Bearer`. Each step runs on the tenant's node.
export class ScanEndpoint {
  private constructor() {}

  public static async handle(request: Request, splat: string): Promise<Response> {
    const [rawRef, step, ...extra] = splat.split("/");
    const ref = rawRef ? ScanRefs.parse(rawRef) : null;
    if (!ref || !step || !STEPS.has(step) || extra.length > 0)
      return new Response(null, { status: 404 });
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    const actor = SystemPrincipal.forOrganization(ref.organizationId);
    try {
      const body = await container.placedAt(ref.organizationId, async () => {
        switch (step) {
          case "checkout":
            return container.scans.checkout.execute(ref, token);
          case "upload":
            return container.scans.upload.execute(ref, token);
          case "complete":
            return container.scans.complete.execute(actor, ref, token);
          default: {
            const payload = (await request.json().catch(() => ({}))) as { error?: unknown };
            await container.scans.fail.execute(
              actor,
              ref,
              token,
              typeof payload.error === "string" ? payload.error : "",
            );
            return { ok: true };
          }
        }
      });
      return Response.json(body);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const status =
        code === "UNAUTHORIZED"
          ? 401
          : code === "NOT_FOUND"
            ? 404
            : code === "UNAVAILABLE"
              ? 503
              : 500;
      return new Response(null, { status });
    }
  }
}
