import { useMessages } from "../i18n/index.js";
import {
  type AuthClient,
  Button,
  Callout,
  type FormEvent,
  SessionMutations,
  useState,
} from "../import.js";
import { PasswordPair, passwordPairReady } from "./password-pair.js";

export interface ResetPasswordFormProps {
  readonly auth: AuthClient;
  // Off the query string, put there by Better Auth's own redirect. The route validates
  // its presence; this component treats it as opaque and never inspects it.
  readonly token: string;
  readonly onSuccess: () => void;
}

export function ResetPasswordForm({ auth, token, onSuccess }: ResetPasswordFormProps) {
  const { t } = useMessages("auth");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const reset = SessionMutations.useResetPassword(auth);

  const ready = passwordPairReady(password, confirmation);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    reset.mutate({ token, newPassword: password }, { onSuccess });
  };

  return (
    <form onSubmit={submit} noValidate>
      <PasswordPair
        idPrefix="reset"
        label={t("auth.resetNewPassword")}
        password={password}
        confirmation={confirmation}
        onPasswordChange={setPassword}
        onConfirmationChange={setConfirmation}
      />

      {
        // One message for expired and already-spent alike: both mean "ask for another".
      }
      {reset.isError ? <Callout tone="danger">{t("auth.resetFailed")}</Callout> : null}

      <Button type="submit" disabled={reset.isPending || !ready}>
        {t("auth.resetSubmit")}
      </Button>
    </form>
  );
}
