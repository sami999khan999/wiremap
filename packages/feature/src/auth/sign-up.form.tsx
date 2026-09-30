import { useMessages } from "../i18n/index.js";
import {
  type AuthClient,
  Button,
  ErrorNormalizer,
  Field,
  type FormEvent,
  fieldClassName,
  Input,
  SessionMutations,
  useState,
} from "../import.js";
import { PasswordPair, passwordPairReady } from "./password-pair.js";

export interface SignUpFormProps {
  // A prop, not a module import. The instance differs per environment, and a module
  // singleton in an SSR bundle is shared across requests.
  readonly auth: AuthClient;
  // Where the link in the verification email should land. The app owns its own routes,
  // so this package is told rather than deciding.
  readonly verifyCallbackUrl: string;
  // Handed the address: the next screen renders it back, and this form is about to stop
  // existing.
  readonly onSuccess: (email: string) => void;
}

export function SignUpForm({ auth, verifyCallbackUrl, onSuccess }: SignUpFormProps) {
  const { t } = useMessages("auth");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const signUp = SessionMutations.useSignUp(auth);

  // Derived, not state: a validity flag stored beside its own inputs gets out of step for
  // one render.
  const ready = passwordPairReady(password, confirmation);

  // Branch on the code, never the message: matching prose is already broken in every
  // locale but English.
  const failure = signUp.isError ? ErrorNormalizer.normalize(signUp.error).code : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;

    signUp.mutate(
      { name, email, password, callbackURL: verifyCallbackUrl },
      { onSuccess: () => onSuccess(email) },
    );
  };

  return (
    <form onSubmit={submit} noValidate>
      <Field label={t("auth.name")} htmlFor="sign-up-name">
        <Input
          id="sign-up-name"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </Field>

      <Field label={t("auth.email")} htmlFor="sign-up-email">
        <Input
          id="sign-up-email"
          type="email"
          // What password managers key on: omitting it is a usability cost for users who
          // will not report it.
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </Field>

      <PasswordPair
        idPrefix="sign-up"
        label={t("auth.password")}
        password={password}
        confirmation={confirmation}
        onPasswordChange={setPassword}
        onConfirmationChange={setConfirmation}
      />

      {
        // The one flow that cannot hide whether an address is registered: the
        // alternative claims an account was created when it was not.
      }
      {failure ? (
        <p role="alert" className={fieldClassName.error}>
          {failure === "CONFLICT" ? t("auth.emailTaken") : t("auth.signUpFailed")}
        </p>
      ) : null}

      <Button type="submit" disabled={signUp.isPending || !ready}>
        {signUp.isPending ? t("auth.signingUp") : t("auth.signUp")}
      </Button>
    </form>
  );
}
