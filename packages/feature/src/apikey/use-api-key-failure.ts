import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import { useCallback } from "../import.js";

// The two keys the middleware itself refuses on. A FORBIDDEN naming anything else came
// from the use-case, and means "not a scope you hold" rather than "not you".
const GATE_KEYS: ReadonlySet<string> = Object.freeze(
  new Set<string>(["apikey.read", "apikey.manage"]),
);

export function useApiKeyFailure() {
  const { t } = useMessages("apikey");
  const describe = useErrorMessage();

  return useCallback(
    (thrown: unknown): string | null => {
      const failure = describe(thrown);
      if (!failure) return null;

      const { code, context, fields } = failure.envelope;

      if (code === "FORBIDDEN" && !GATE_KEYS.has(String(context.permission))) {
        return t("apikey.error.escalate");
      }

      // `BAD_REQUEST` carries the field, which is what separates "that scope is not in
      // the catalog" from "that expiry is in the past".
      if (code === "BAD_REQUEST") {
        const field = fields?.[0]?.field;
        if (field === "scopes") return t("apikey.error.scopes");
        if (field === "expiresAt") return t("apikey.error.past");
      }

      return failure.message;
    },
    [t, describe],
  );
}
