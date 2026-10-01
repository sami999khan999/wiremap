import { z } from "../import.js";

// One key per kind of feature, null for none. Strings here: contracts cannot know which
// keys exist, so the use-case checks them against the registries before saving.
const key = z.string().trim().min(1).max(120).nullable().default(null);

// The features a doc follows. Every link set must pass for a reader to see it, and a doc
// with no link set is read as before. See packages/application/docs/reference/doc.md.
const rule = z.object({
  module: key,
  permission: key,
  flag: key,
  plan: key,
});

// The choices a writer may pick from, each with the label the registry gives it.
const option = z.object({ key: z.string(), label: z.string() });

export class DocAccessContract {
  private constructor() {}

  public static readonly rule = rule;

  public static readonly options = z.object({
    modules: z.array(option).readonly(),
    permissions: z.array(option).readonly(),
    flags: z.array(option).readonly(),
    plans: z.array(option).readonly(),
  });
}

export type DocAccessRuleDto = z.infer<typeof rule>;
export type DocAccessOptionsDto = z.infer<typeof DocAccessContract.options>;
