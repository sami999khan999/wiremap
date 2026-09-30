import type { ErrorEnvelope } from "@loadbearing/errors";

// What a rejected procedure actually hands a component: the oRPC client decodes the
// response into this, and our envelope rides underneath in `data`.
export interface DecodedTransportError {
  readonly defined: boolean;
  readonly code: string;
  readonly status: number;
  readonly message: string;
  readonly data: ErrorEnvelope;
}

// Every other feature spec rejects with an `AppError` instance, which is the shape a
// component never sees over HTTP — and is why three screens crashed on a refusal.
export const transportError = (envelope: ErrorEnvelope, status = 409): DecodedTransportError => ({
  defined: false,
  code: envelope.code,
  status,
  message: "Conflict",
  data: envelope,
});
