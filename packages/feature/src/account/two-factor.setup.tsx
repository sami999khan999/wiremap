import { useMessages } from "../i18n/index.js";
import {
  type AccountClient,
  AccountMutations,
  Button,
  Callout,
  CodeList,
  Field,
  type FormEvent,
  Input,
  QrCode,
  useState,
} from "../import.js";

// Password, then scan, then prove it scanned. The third step is not ceremony: enabling
// on the strength of a QR nobody scanned locks someone out at their next sign-in.
type Step = "password" | "verify" | "done";

export interface TwoFactorSetupProps {
  readonly account: AccountClient;
  readonly onEnabled: () => void;
}

export function TwoFactorSetup({ account, onEnabled }: TwoFactorSetupProps) {
  const { t } = useMessages("account");
  const [step, setStep] = useState<Step>("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<readonly string[]>([]);

  const enable = AccountMutations.useEnableTwoFactor(account);
  const verify = AccountMutations.useVerifyTotpEnrolment(account);

  const start = (event: FormEvent) => {
    event.preventDefault();
    enable.mutate(
      { password },
      {
        onSuccess: (enrolment) => {
          setTotpUri(enrolment.totpUri);
          setBackupCodes(enrolment.backupCodes);
          // Dropped as soon as it is spent: holding it is a password sitting in a React
          // tree for no further reason.
          setPassword("");
          setStep("verify");
        },
      },
    );
  };

  const finish = (event: FormEvent) => {
    event.preventDefault();
    verify.mutate({ code }, { onSuccess: () => setStep("done") });
  };

  if (step === "password") {
    return (
      <form onSubmit={start} noValidate>
        {
          // The password stops a stolen session enrolling its own authenticator and
          // locking the owner out permanently.
        }
        <Field label={t("account.twoFactorConfirmPassword")} htmlFor="enable-password">
          <Input
            id="enable-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>

        {enable.isError ? (
          <Callout tone="danger">{t("account.changePasswordFailed")}</Callout>
        ) : null}

        <Button type="submit" disabled={enable.isPending || password.length === 0}>
          {t("account.twoFactorEnable")}
        </Button>
      </form>
    );
  }

  if (step === "verify") {
    return (
      <form onSubmit={finish} noValidate>
        <QrCode value={totpUri} label={t("account.twoFactorScan")} />
        <p className="ui-field__hint">{t("account.twoFactorScan")}</p>

        {
          // The same string the QR encodes, for an authenticator with no camera — so
          // there is nothing to keep in step.
        }
        <Field label={t("account.twoFactorManual")} htmlFor="totp-uri">
          <Input id="totp-uri" readOnly value={totpUri} />
        </Field>

        <Field
          label={t("account.twoFactorCode")}
          htmlFor="enrolment-code"
          hint={t("account.twoFactorVerifyPrompt")}
        >
          <Input
            id="enrolment-code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
        </Field>

        {verify.isError ? (
          <p role="alert" className="ui-field__error">
            {t("account.twoFactorFailed")}
          </p>
        ) : null}

        <Button type="submit" disabled={verify.isPending || code.length === 0}>
          {t("account.saveChanges")}
        </Button>
      </form>
    );
  }

  return (
    <>
      <Callout tone="success">{t("account.twoFactorEnabled")}</Callout>

      {
        // Shown once and never again, so the warning carries its whole weight here.
      }
      <Callout tone="warning" title={t("account.backupCodes")}>
        {t("account.backupCodesHint")}
      </Callout>
      <CodeList values={backupCodes} label={t("account.backupCodes")} />

      <Button onClick={onEnabled}>{t("account.saveChanges")}</Button>
    </>
  );
}
