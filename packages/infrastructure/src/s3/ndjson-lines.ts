import { createGunzip, type Hash, Readable } from "../import.js";

// NDJSON is newline-delimited by definition, so the separator is data rather than
// formatting.
const NEWLINE = "\n";

// A gzipped NDJSON object as lines, decoded as the bytes arrive: neither the compressed
// body nor the text is ever whole in memory (`CR.16`).
export class NdjsonLines {
  private constructor() {}

  // `hash` sees the **compressed** bytes on their way through, which is what the archive
  // hashed on the way up.
  public static async *of(source: AsyncIterable<Uint8Array>, hash?: Hash): AsyncGenerator<string> {
    const input = Readable.from(NdjsonLines.tapped(source, hash));
    const gunzip = createGunzip();
    // `pipe` does not forward an error from the source, and a read that failed halfway
    // would otherwise end as a short, clean stream.
    input.on("error", (error: Error) => gunzip.destroy(error));
    input.pipe(gunzip);

    const decoder = new TextDecoder();
    let pending = "";

    for await (const chunk of gunzip as AsyncIterable<Uint8Array>) {
      const lines = (pending + decoder.decode(chunk, { stream: true })).split(NEWLINE);
      pending = lines.pop() ?? "";
      for (const line of lines) if (line.length > 0) yield line;
    }

    pending += decoder.decode();
    if (pending.length > 0) yield pending;
  }

  private static async *tapped(
    source: AsyncIterable<Uint8Array>,
    hash: Hash | undefined,
  ): AsyncGenerator<Uint8Array> {
    for await (const chunk of source) {
      hash?.update(chunk);
      yield chunk;
    }
  }
}
