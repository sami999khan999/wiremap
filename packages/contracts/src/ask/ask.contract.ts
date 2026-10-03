import { z } from "../import.js";
import { Identifiers } from "../primitive/index.js";

export const AI_PROVIDERS = ["none", "gemini"] as const;

export class AskContract {
  private constructor() {}

  // What the settings page shows. The key itself never comes back: only its last four.
  public static readonly settings = z.object({
    enabled: z.boolean(),
    provider: z.enum(AI_PROVIDERS),
    model: z.string(),
    keyHint: z.string().nullable(),
  });

  public static readonly updateSettings = z.object({
    enabled: z.boolean(),
    provider: z.enum(AI_PROVIDERS),
    model: z.string().trim().min(1).max(80),
    // Absent keeps the stored key; null removes it. Write-only, never read back.
    apiKey: z.string().trim().min(10).max(200).nullable().optional(),
  });

  public static readonly testResult = z.object({ ok: z.boolean() });

  public static readonly question = z.object({
    projectId: Identifiers.projectId,
    // The question, or a preset that writes one: explain a file, a folder, or a route, or
    // summarise the project for someone new to it.
    question: z.string().trim().min(1).max(2_000),
    preset: z.enum(["file", "folder", "route", "onboarding"]).nullable(),
    // The previous turns of this thread, newest last, so a follow-up has its context.
    history: z
      .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(8_000) }))
      .max(10),
  });

  // A streamed answer: text as it arrives, then one `done` naming what grounded it.
  public static readonly chunk = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), text: z.string() }),
    z.object({
      kind: z.literal("done"),
      cached: z.boolean(),
      scanId: Identifiers.scanId,
      files: z.array(z.string()).readonly(),
    }),
  ]);
}

export type AiSettingsDto = z.infer<typeof AskContract.settings>;
export type UpdateAiSettingsInput = z.infer<typeof AskContract.updateSettings>;
export type AskQuestionInput = z.infer<typeof AskContract.question>;
export type AskChunk = z.infer<typeof AskContract.chunk>;
