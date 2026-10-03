import { container } from "./container.js";

interface DeliveryPayload {
  readonly action?: unknown;
  readonly ref?: unknown;
  readonly deleted?: unknown;
  readonly installation?: { readonly id?: unknown } | null;
  readonly repository?: { readonly id?: unknown; readonly full_name?: unknown } | null;
}

// The two requests GitHub makes to wiremap: the post-install redirect, in the browser of
// the person who installed, and webhook deliveries, signed. See docs/infra/github-app.md.
export class GithubEndpoint {
  private constructor() {}

  // Binds the installation to the organization the signed `state` names, which must be the
  // signed-in person's active one. Anything else lands back on the page with an error flag.
  public static async setup(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const back = (result: "connected" | "failed") =>
      new Response(null, { status: 302, headers: { location: `/projects/new?github=${result}` } });

    const installationId = Number(url.searchParams.get("installation_id"));
    const state = url.searchParams.get("state");
    if (!Number.isSafeInteger(installationId) || installationId <= 0 || !state) {
      return back("failed");
    }

    const principal = await container.principals.fromHeaders(request.headers);
    if (!principal) return new Response(null, { status: 302, headers: { location: "/sign-in" } });

    try {
      await container.github.bind.execute(principal, {
        installationId,
        state,
        code: url.searchParams.get("code"),
      });
      return back("connected");
    } catch {
      return back("failed");
    }
  }

  // 401 for a bad signature, 202 for anything verified, applied or not: GitHub retries
  // nothing, so a 5xx only fills its delivery log.
  public static async webhook(request: Request): Promise<Response> {
    const body = await request.text();
    if (
      !container.repositoryProvider.verifyWebhook(body, request.headers.get("x-hub-signature-256"))
    ) {
      return new Response(null, { status: 401 });
    }

    let payload: DeliveryPayload;
    try {
      payload = JSON.parse(body) as DeliveryPayload;
    } catch {
      return new Response(null, { status: 400 });
    }

    // A signed delivery stays valid forever, so a captured one could be replayed to queue
    // scans. GitHub's delivery id is unique: the second sighting in a day does nothing.
    const delivery = request.headers.get("x-github-delivery");
    if (delivery) {
      const fresh = await container.cache
        .setIfAbsent(`github:delivery:${delivery}`, 1, 86_400)
        .catch(() => true);
      if (!fresh) return new Response(null, { status: 202 });
    }

    const installationId = payload.installation?.id;
    const repository = payload.repository;
    // Webhooks reach this installation, so the hourly branch polling can leave it alone.
    if (typeof installationId === "number") {
      await container.scans.poll.webhookSeen(installationId).catch(() => undefined);
    }
    const outcome = await container.github.webhook.execute({
      event: request.headers.get("x-github-event") ?? "",
      action: typeof payload.action === "string" ? payload.action : null,
      installationId: typeof installationId === "number" ? installationId : null,
      repository:
        repository && typeof repository.id === "number" && typeof repository.full_name === "string"
          ? { id: repository.id, fullName: repository.full_name }
          : null,
      ref: typeof payload.ref === "string" ? payload.ref : null,
      deleted: payload.deleted === true,
    });
    // Each project the push tracks, queued on its own tenant's node.
    if (outcome.kind === "push") {
      for (const target of outcome.targets) {
        await container.placedAt(target.organizationId, () =>
          container.scans.trigger.execute({ ...target, trigger: "push" }),
        );
      }
    }
    return new Response(null, { status: 202 });
  }
}
