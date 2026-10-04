import { PasswordField } from "../auth/index.js";
import { useMessages } from "../i18n/index.js";
import {
  type AccountClient,
  AccountMutations,
  Button,
  Callout,
  CodeList,
  Field,
  type FormEvent,
  useState,
} from "../import.js";

export interface TwoFactorPanelProps {
  readonly account: AccountClient;
}

// Turning two-factor off, or replacing the backup codes. Both take the password: a
// stolen session must not remove the factor protecting the account.
export function TwoFactorPanel({ account }: TwoFactorPanelProps) {
  const { t } = useMessages("account");
  const [password, setPassword] = useState("");
  const [fresh, setFresh] = useState<readonly string[]>([]);

  const disable = AccountMutations.useDisableTwoFactor(account);
  const regenerate = AccountMutations.useRegenerateBackupCodes(account);

  const pending = disable.isPending || regenerate.isPending;

  const spend = (event: FormEvent) => {
    event.preventDefault();
    disable.mutate(
      { password },
      {
        onSuccess: () => {
          setPassword("");
          // Codes for a factor that no longer exists. They stayed on screen because
          // `regenerate.isSuccess` is sticky and nothing cleared it.
          setFresh([]);
          regenerate.reset();
        },
      },
    );
  };

  return (
    <form onSubmit={spend} noValidate>
      <Callout tone="success">{t("account.twoFactorOn")}</Callout>

      <Field label={t("account.twoFactorConfirmPassword")} htmlFor="disable-password">
        <PasswordField
          id="disable-password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </Field>

      {disable.isError || regenerate.isError ? (
        <Callout tone="danger">{t("account.changePasswordFailed")}</Callout>
      ) : null}

      {
        // The new codes replace every previous one, which is the point rather than a
        // side effect.
      }
      {fresh.length > 0 ? (
        <>
          <Callout tone="warning" title={t("account.backupCodesRegenerated")}>
            {t("account.backupCodesHint")}
          </Callout>
          <CodeList values={fresh} label={t("account.backupCodes")} />
        </>
      ) : null}

      <Button
        variant="secondary"
        disabled={pending || password.length === 0}
        onClick={() =>
          regenerate.mutate(
            { password },
            {
              onSuccess: (codes) => {
                setFresh(codes);
                setPassword("");
              },
            },
          )
        }
      >
        {t("account.backupCodesRegenerate")}
      </Button>

      <Button type="submit" variant="danger" disabled={pending || password.length === 0}>
        {t("account.twoFactorDisable")}
      </Button>
    </form>
  );
}
