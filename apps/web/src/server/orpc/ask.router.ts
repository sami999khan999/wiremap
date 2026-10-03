import { authed } from "../import.js";

export class AskRouter {
  private constructor() {}

  public static readonly settings = authed.ask.settings.handler(({ context }) =>
    context.container.ask.settings.get(context.principal),
  );

  public static readonly updateSettings = authed.ask.updateSettings.handler(({ input, context }) =>
    context.container.ask.settings.update(context.principal, input),
  );

  public static readonly testKey = authed.ask.testKey.handler(({ context }) =>
    context.container.ask.settings.test(context.principal),
  );

  public static readonly available = authed.ask.available.handler(({ context }) =>
    context.container.ask.settings.available(context.principal),
  );

  // Streamed: each piece of the answer as the model writes it. A closed tab aborts the
  // request, and with it the model call.
  public static readonly question = authed.ask.question.handler(async function* ({
    input,
    context,
    signal,
  }) {
    yield* context.container.ask.question.execute(context.principal, input, signal);
  });

  public static readonly all = {
    settings: AskRouter.settings,
    updateSettings: AskRouter.updateSettings,
    testKey: AskRouter.testKey,
    available: AskRouter.available,
    question: AskRouter.question,
  } as const;
}
