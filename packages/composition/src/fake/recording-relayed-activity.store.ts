import { type RelayedActivity, RelayedActivityStore } from "../import.js";

// Keyed by id, as the real store is: a redelivered event writes nothing a second time,
// and a spec about the relay asserts exactly that.
export class RecordingRelayedActivityStore extends RelayedActivityStore {
  private readonly rows = new Map<string, RelayedActivity>();

  public override save(entry: RelayedActivity): Promise<void> {
    if (!this.rows.has(entry.id)) this.rows.set(entry.id, entry);
    return Promise.resolve();
  }

  public saved(): readonly RelayedActivity[] {
    return [...this.rows.values()];
  }
}
