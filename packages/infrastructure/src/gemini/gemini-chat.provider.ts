import { type CancelSignal, ChatProvider, type ChatRequest, UnavailableError } from "../import.js";

interface StreamPayload {
  readonly candidates?: readonly {
    readonly content?: { readonly parts?: readonly { readonly text?: string }[] };
  }[];
}

// Gemini's `streamGenerateContent` over `fetch`, as server-sent events: no SDK, like the
// embedding adapter. The organization's own key goes in a header, never the URL.
export class GeminiChatProvider extends ChatProvider {
  private static readonly BASE = "https://generativelanguage.googleapis.com/v1beta";

  public constructor(
    private readonly http: typeof fetch = fetch,
    private readonly base: string = GeminiChatProvider.BASE,
  ) {
    super();
  }

  public override async *stream(
    request: ChatRequest,
    signal?: CancelSignal,
  ): AsyncIterable<string> {
    const response = await this.http(
      `${this.base}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": request.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: request.turns.map((turn) => ({
            role: turn.role === "assistant" ? "model" : "user",
            parts: [{ text: turn.text }],
          })),
          generationConfig: { temperature: 0.2, maxOutputTokens: 2_048 },
        }),
        // The caller hands a real `AbortSignal`; the port names only the part it reads.
        ...(signal ? { signal: signal as AbortSignal } : {}),
      },
    );
    if (!response.ok || !response.body) throw new UnavailableError("gemini.chat", response.status);

    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.startsWith("data:")) continue;
        const text = GeminiChatProvider.textOf(line.slice(5).trim());
        if (text) yield text;
      }
    }
  }

  public override async test(apiKey: string, model: string): Promise<boolean> {
    const response = await this.http(
      `${this.base}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Reply with OK." }] }],
          generationConfig: { maxOutputTokens: 4 },
        }),
      },
    ).catch(() => null);
    return response?.ok ?? false;
  }

  private static textOf(data: string): string {
    try {
      const payload = JSON.parse(data) as StreamPayload;
      return (payload.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join("");
    } catch {
      return "";
    }
  }
}
