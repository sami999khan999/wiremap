import { JobConsumer } from "./consumer/index.js";
import type { Env } from "./env.js";
import type { DispatchedMessage } from "./primitive/index.js";
import { EnqueueRouter } from "./route/index.js";
import { CronSchedule } from "./schedule/index.js";

// The three handlers Cloudflare calls. Each is one line into a class a spec can reach.
export default {
  fetch: (request, env) => EnqueueRouter.handle(request, env),
  queue: (batch, env) => JobConsumer.handle(batch, env),
  scheduled: async (controller, env) => {
    const jobs = CronSchedule.jobsFor(controller.cron, new Date(controller.scheduledTime));
    if (jobs.length > 0) await env.JOBS.sendBatch(jobs.map((body) => ({ body })));
  },
} satisfies ExportedHandler<Env, DispatchedMessage>;
