import { ActivityLogger, type Principal } from "../import.js";

export interface RecordedActivity {
  readonly actor: Principal;
  readonly action: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

// The audit assertion. A use-case that changes state without writing one of these is
// the failure this fake exists to catch, so it records rather than counts.
export class RecordingActivityLogger extends ActivityLogger {
  private readonly entries: RecordedActivity[] = [];

  public override record(
    actor: Principal,
    action: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    this.entries.push({ actor, action, payload });
    return Promise.resolve();
  }

  public recorded(): readonly RecordedActivity[] {
    return this.entries;
  }

  public actions(): readonly string[] {
    return this.entries.map((entry) => entry.action);
  }
}
