import { useTranslator } from "../i18n/index.js";
import {
  ErrorCopy,
  type ErrorEnvelope,
  ErrorNormalizer,
  type Translator,
  useCallback,
} from "../import.js";

export interface ErrorMessage {
  // The sentence for the code. Always present, because `ERROR_CATALOG` is closed and
  // `ERROR_COPY` is total over it — there is no unmapped failure.
  readonly message: string;
  // One per field violation, in envelope order. Empty for anything but a validation
  // failure, so a caller renders it without asking what kind of error it holds.
  readonly fields: readonly string[];
  readonly envelope: ErrorEnvelope;
}

// Normalises whatever a mutation or query threw and renders it through `content`. Every
// call site that reached for `state.error` was discarding the code the server sent.
export function useErrorMessage() {
  const translator = useTranslator();

  return useCallback(
    (thrown: unknown): ErrorMessage | null => {
      if (thrown === null || thrown === undefined) return null;
      return describe(translator, ErrorNormalizer.normalize(thrown).toJSON());
    },
    [translator],
  );
}

function describe(translator: Translator, envelope: ErrorEnvelope): ErrorMessage {
  return {
    message: ErrorCopy.message(translator, envelope),
    fields: ErrorCopy.fields(translator, envelope),
    envelope,
  };
}
