// A queue's id grammar is not ours, and the strings we build one from are a caller's.
// BullMQ refuses a `:` outright, which made `doc:1` a 500 rather than a BAD_REQUEST.
export class JobKey {
  private constructor() {}

  // FNV-1a, 32-bit, written out rather than imported: `application` names no framework
  // and stays isomorphic, so a `node:crypto` digest here would make the domain node-only.
  private static hash(value: string): string {
    let hash = 0x811c9dc5;

    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      // The 32-bit FNV prime, as shifts: `Math.imul` keeps the multiply from overflowing
      // into a float, which is where a hand-rolled version of this usually goes wrong.
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    return hash.toString(16).padStart(8, "0");
  }

  // Hex, so nothing a caller supplies reaches the id verbatim, and bounded, so a job id
  // cannot grow with an input the queue will then reject for its length.
  public static of(...parts: readonly string[]): string {
    return JobKey.hash(parts.join("\u0000"));
  }
}
