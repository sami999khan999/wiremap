export interface ChatTurn {
  readonly role: "user" | "assistant";
  readonly text: string;
}

// The part of an `AbortSignal` the domain needs: it names no runtime's own types.
export interface CancelSignal {
  readonly aborted: boolean;
}

export interface ChatRequest {
  readonly apiKey: string;
  readonly model: string;
  readonly system: string;
  readonly turns: readonly ChatTurn[];
}

// A model that streams an answer. The key is per call: each organization brings its own,
// and there is no platform key to fall back to.
export abstract class ChatProvider {
  public abstract stream(request: ChatRequest, signal?: CancelSignal): AsyncIterable<string>;

  // One minimal request: true when the key and model answer at all.
  public abstract test(apiKey: string, model: string): Promise<boolean>;
}
