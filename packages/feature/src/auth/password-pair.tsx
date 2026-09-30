import { useMessages } from "../i18n/index.js";
import { Field, Input, Password } from "../import.js";

export interface PasswordPairProps {
  // Prefixes both ids and both `htmlFor`s, so two of these on one page stay distinct.
  readonly idPrefix: string;
  // The new-password field's own label. "Password" on sign-up, "New password" on the two
  // that replace an existing one.
  readonly label: string;
  readonly password: string;
  readonly confirmation: string;
  readonly onPasswordChange: (value: string) => void;
  readonly onConfirmationChange: (value: string) => void;
}

// The three forms that set a password — sign-up, reset, change — asked the same two
// questions with the same two rules and three copies of the answer.
export function PasswordPair({
  idPrefix,
  label,
  password,
  confirmation,
  onPasswordChange,
  onConfirmationChange,
}: PasswordPairProps) {
  const { t } = useMessages("auth");

  // Only once something has been typed: an untouched field is not yet wrong.
  const tooShort = password.length > 0 && password.length < Password.MIN_LENGTH;
  const mismatch = confirmation.length > 0 && confirmation !== password;

  return (
    <>
      <Field
        label={label}
        htmlFor={`${idPrefix}-password`}
        error={tooShort ? t("auth.passwordTooShort") : undefined}
      >
        <Input
          id={`${idPrefix}-password`}
          type="password"
          // `new-password`, not `current-password`: it tells a password manager to offer
          // to generate one rather than fill the old one in.
          autoComplete="new-password"
          minLength={Password.MIN_LENGTH}
          maxLength={Password.MAX_LENGTH}
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          required
        />
      </Field>

      <Field
        label={t("auth.confirmPassword")}
        htmlFor={`${idPrefix}-confirmation`}
        error={mismatch ? t("auth.passwordMismatch") : undefined}
      >
        <Input
          id={`${idPrefix}-confirmation`}
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => onConfirmationChange(event.target.value)}
          required
        />
      </Field>
    </>
  );
}

// The submit guard the three forms share: a pair is usable when both are filled, long
// enough and equal. Exported beside the component so no caller re-derives it.
export function passwordPairReady(password: string, confirmation: string): boolean {
  return password.length >= Password.MIN_LENGTH && password === confirmation;
}
