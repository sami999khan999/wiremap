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

export interface ForgotPasswordFormProps {
  readonly auth: AuthClient;
  // Where Better Auth sends the browser once it has spent the token, carrying the new
  // token on the query string for the reset form there.
  readonly resetUrl: string;
}

export function ForgotPasswordForm({ auth, resetUrl }: ForgotPasswordFormProps) {
  const { t } = useMessages("auth");
  const [email, setEmail] = useState("");

  const request = SessionMutations.useRequestPasswordReset(auth);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    request.mutate({ email, redirectTo: resetUrl });
  };

  // The form is replaced by the confirmation rather than sitting under it. Leaving it
  // on screen invites a second submission, and the second one is rate-limited.
  if (request.isSuccess) {
    return <Callout tone="success">{t("auth.resetSent")}</Callout>;
  }

  return (
    <form onSubmit={submit} noValidate>
      <Field label={t("auth.email")} htmlFor="forgot-email">
        <Input
          id="forgot-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </Field>

      {
        // No error branch by design: a failure a visitor can tell apart from a success
        // is an oracle for which addresses are registered.
      }

      <Button type="submit" disabled={request.isPending}>
        {t("auth.resetRequest")}
      </Button>
    </form>
  );
}
