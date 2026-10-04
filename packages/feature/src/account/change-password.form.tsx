import { PasswordField } from "../auth/index.js";
import { PasswordPair, passwordPairReady } from "../auth/password-pair.js";
import { useMessages } from "../i18n/index.js";
import {
  type AccountClient,
  AccountMutations,
  Button,
  Callout,
  Field,
  type FormEvent,
  useState,
} from "../import.js";

export interface ChangePasswordFormProps {
  readonly account: AccountClient;
}

export function ChangePasswordForm({ account }: ChangePasswordFormProps) {
  const { t } = useMessages("account");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const change = AccountMutations.useChangePassword(account);

  const ready = passwordPairReady(next, confirmation);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        // Cleared on success, not left filled. A settings page that keeps three
        // populated password fields after a save is one stray click from re-submitting.
        onSuccess: () => {
          setCurrent("");
          setNext("");
          setConfirmation("");
        },
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate>
      <Field label={t("account.currentPassword")} htmlFor="current-password">
        <PasswordField
          id="current-password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          required
        />
      </Field>

      <PasswordPair
        idPrefix="new"
        label={t("account.resetNewPassword")}
        password={next}
        confirmation={confirmation}
        onPasswordChange={setNext}
        onConfirmationChange={setConfirmation}
      />

      {
        // The copy says other devices were signed out because they were:
        // `revokeOtherSessions` is set on the call.
      }
      {change.isSuccess ? (
        <Callout tone="success">{t("account.changePasswordDone")}</Callout>
      ) : null}
      {change.isError ? <Callout tone="danger">{t("account.changePasswordFailed")}</Callout> : null}

      <Button type="submit" disabled={change.isPending || !ready}>
        {t("account.changePassword")}
      </Button>
    </form>
  );
}
