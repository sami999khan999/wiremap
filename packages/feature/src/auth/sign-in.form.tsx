import { useErrorMessage } from "../error/index.js";
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
import { PasswordField } from "./password-field.js";

export interface SignInFormProps {
  // A prop, not a module import. The instance differs per environment, and a module
  // singleton in an SSR bundle is shared across requests.
  readonly auth: AuthClient;
  readonly onSuccess: () => void;
  readonly onNeedsTwoFactor?: () => void;
}

export function SignInForm({ auth, onSuccess, onNeedsTwoFactor }: SignInFormProps) {
  const { t } = useMessages("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Distinct from `signIn.isError`: the second-factor fork arrives as a rejection so both
  // legs share one path, but it is not a failed sign-in.
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);

  const signIn = SessionMutations.useSignIn(auth);
  const describe = useErrorMessage();
  // The one refusal that names its reason: the password was right, so it discloses nothing.
  const failure = describe(signIn.error);
  const suspended = failure?.envelope.code === "ACCOUNT_SUSPENDED";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNeedsTwoFactor(false);
    signIn.mutate(
      { email, password },
      {
        onSuccess: () => onSuccess(),
        // Branch on the code, never the message: matching prose breaks the moment
        // somebody rewords it, and is already broken in every locale but English.
        onError: (error) => {
          if (ErrorNormalizer.normalize(error).code === "TWO_FACTOR_REQUIRED") {
            setNeedsTwoFactor(true);
            onNeedsTwoFactor?.();
          }
        },
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate>
      <Field label={t("auth.email")} htmlFor="sign-in-email">
        <Input
          id="sign-in-email"
          type="email"
          // What password managers key on: omitting it is a usability cost for users who
          // will not report it.
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </Field>

      <Field label={t("auth.password")} htmlFor="sign-in-password">
        <PasswordField
          id="sign-in-password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </Field>

      {
        // Deliberately generic: distinguishing "no such account" from "wrong password"
        // is an account-enumeration oracle.
      }
      {signIn.isError && !needsTwoFactor ? (
        <p role="alert" className={fieldClassName.error}>
          {suspended ? failure.message : t("auth.signInFailed")}
        </p>
      ) : null}

      <Button type="submit" disabled={signIn.isPending}>
        {signIn.isPending ? t("auth.signingIn") : t("auth.signIn")}
      </Button>
    </form>
  );
}
