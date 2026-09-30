import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import { useCallback } from "../import.js";

// The four reasons a role write refuses, keyed by what `ConflictError` carries.
const CONFLICT_COPY = Object.freeze({
  reserved: "role.error.reserved",
  duplicate: "role.error.duplicate",
  system: "role.error.system",
  inUse: "role.error.inUse",
} as const);

// The two keys the middleware itself refuses on. A FORBIDDEN naming anything else came
// from the grant use-case, and means "not one you hold" rather than "not you".
const GATE_KEYS: ReadonlySet<string> = Object.freeze(
  new Set<string>(["rbac.role.manage", "rbac.permission.grant", "rbac.permission.revoke"]),
);

// Every role screen renders the same five refusals, and the catalog's generic sentences
// are wrong about all of them — a CONFLICT here is never "someone else changed this".
export function useRoleFailure() {
  const { t } = useMessages("role");
  const describe = useErrorMessage();

  return useCallback(
    (thrown: unknown): string | null => {
      const failure = describe(thrown);
      if (!failure) return null;

      const { code, context } = failure.envelope;

      if (code === "CONFLICT") {
        const reason = String(context.reason);
        // `Object.hasOwn`, not `in`, for the reason `AppError.isKnownCode` gives: `in`
        // walks the prototype chain, and `t(Object.prototype.toString)` renders nothing.
        if (Object.hasOwn(CONFLICT_COPY, reason)) {
          return t(CONFLICT_COPY[reason as keyof typeof CONFLICT_COPY]);
        }
      }

      if (code === "FORBIDDEN" && !GATE_KEYS.has(String(context.permission))) {
        return t("role.error.escalate");
      }

      return failure.message;
    },
    [t, describe],
  );
}
