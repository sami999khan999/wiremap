// `lib` is `["ES2024"]` and nothing else, so there is no `AbortSignal` here — adding DOM
// to reach one would put every browser global inside the domain.
export interface CancellationSignal {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
}
