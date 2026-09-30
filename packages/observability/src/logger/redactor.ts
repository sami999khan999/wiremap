import type { LogFields } from "../event/index.js";

// Substring match on the field *name*, lowercased. A prefix list would miss
// `userToken`; an exact list would miss `x-api-key`.
const DENIED: readonly string[] = [
  "authorization",
  "apikey",
  "cookie",
  "credential",
  "passphrase",
  "password",
  "privatekey",
  "secret",
  "sessionid",
  "token",
];

export const REDACTED = "[redacted]";

// The backstop, not the defence: `EventShape` is what stops a token being logged. This
// catches what a `child()` binding drags in, where the type is a bare `LogFields`.
export class Redactor {
  private constructor() {}

  public static isSensitive(name: string): boolean {
    const lowered = name.toLowerCase().replaceAll(/[^a-z]/g, "");
    return DENIED.some((denied) => lowered.includes(denied));
  }

  public static apply(fields: LogFields): LogFields {
    let hit = false;
    const out: Record<string, LogFields[string]> = {};

    for (const [name, value] of Object.entries(fields)) {
      if (Redactor.isSensitive(name)) {
        out[name] = REDACTED;
        hit = true;
      } else {
        out[name] = value;
      }
    }

    // Nothing to redact is the common case, so return the original rather than a copy:
    // this runs on every line the process emits.
    return hit ? out : fields;
  }
}
