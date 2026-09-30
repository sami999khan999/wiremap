import { useMessages } from "../i18n/index.js";
import {
  type AuthClient,
  Button,
  Callout,
  Field,
  type FormEvent,
  Input,
  SessionMutations,
  useState,
} from "../import.js";

// The three ways to finish a sign-in that answered `TWO_FACTOR_REQUIRED`. Alternatives,
// not a sequence.
type Method = "totp" | "backup" | "otp";

export interface TwoFactorFormProps {
  readonly auth: AuthClient;
  readonly onSuccess: () => void;
}

export function TwoFactorForm({ auth, onSuccess }: TwoFactorFormProps) {
  const { t } = useMessages("auth");
  const [method, setMethod] = useState<Method>("totp");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  // Defined mutations rather than raw client calls with hand-rolled pending and error
  // state — the same seam every other form in this package goes through.
  const totp = SessionMutations.useVerifyTotp(auth);
  const backupCode = SessionMutations.useVerifyBackupCode(auth);
  const otp = SessionMutations.useVerifyOtp(auth);
  const sendOtp = SessionMutations.useSendOtp(auth);

  const verify = method === "backup" ? backupCode : method === "otp" ? otp : totp;
  const pending = verify.isPending || sendOtp.isPending;
  const failed = verify.isError || sendOtp.isError;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    verify.mutate({ code }, { onSuccess });
  };

  // Switching method clears the code: a half-typed TOTP carried into the backup-code
  // field submits a guaranteed failure and burns a rate-limit slot.
  const switchTo = (next: Method) => {
    setMethod(next);
    setCode("");
    // Each mutation keeps its own `isError`, so the message the reader is looking at
    // belongs to the method they have left.
    totp.reset();
    backupCode.reset();
    otp.reset();
    sendOtp.reset();
    // The "we sent you a code" notice belongs to the OTP leg. The caller that switches
    // *to* OTP sets it back in the same handler.
    setOtpSent(false);
  };

  const backup = method === "backup";

  return (
    <form onSubmit={submit} noValidate>
      <Field
        label={backup ? t("auth.twoFactorBackupCode") : t("auth.twoFactorCode")}
        htmlFor="two-factor-code"
        hint={backup ? t("auth.twoFactorBackupHint") : t("auth.twoFactorHint")}
      >
        <Input
          id="two-factor-code"
          autoComplete="one-time-code"
          // A backup code is alphanumeric and longer, so only the numeric methods get the
          // keypad and the six-character ceiling.
          inputMode={backup ? "text" : "numeric"}
          pattern={backup ? undefined : "[0-9]*"}
          maxLength={backup ? 24 : 6}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
        />
      </Field>

      {otpSent ? <Callout tone="info">{t("auth.twoFactorOtpSent")}</Callout> : null}

      {failed ? (
        <p role="alert" className="ui-field__error">
          {t("auth.twoFactorFailed")}
        </p>
      ) : null}

      <Button type="submit" disabled={pending || code.length === 0}>
        {pending ? t("auth.signingIn") : t("auth.signIn")}
      </Button>

      {
        // One button per method that is not the current one. A ternary on `totp` left
        // backup codes unreachable from the emailed one-time code.
      }
      {method === "totp" ? null : (
        <Button variant="ghost" onClick={() => switchTo("totp")}>
          {t("auth.twoFactorUseTotp")}
        </Button>
      )}

      {method === "backup" ? null : (
        <Button variant="ghost" onClick={() => switchTo("backup")}>
          {t("auth.twoFactorUseBackup")}
        </Button>
      )}

      {method === "otp" ? null : (
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() =>
            sendOtp.mutate(undefined, {
              onSuccess: () => {
                switchTo("otp");
                setOtpSent(true);
              },
            })
          }
        >
          {t("auth.twoFactorUseOtp")}
        </Button>
      )}
    </form>
  );
}
