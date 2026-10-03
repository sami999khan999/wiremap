import { createFileRoute, Link } from "@tanstack/react-router";
import { Endpoint } from "~/endpoint.js";
import {
  AuthClient,
  type ClientNamespace,
  SignUpForm,
  SocialSignIn,
  useMemo,
  useMessages,
  useState,
  VerifyEmailNotice,
} from "~/import.js";
import { AuthFrame } from "~/route/-auth-frame.js";

const MESSAGES = ["auth"] as const satisfies readonly ClientNamespace[];

export const Route = createFileRoute("/(shell)/sign-up")({
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: SignUpPage,
});

function SignUpPage() {
  const { t } = useMessages("auth");
  const { googleEnabled, githubEnabled } = Route.useRouteContext();
  // The address the notice renders back exists only in the form that is about to be
  // replaced, which is why the state lives here.
  const [registered, setRegistered] = useState<string | null>(null);

  // Memoised: a bare `new` in the body builds a fresh client on every keystroke.
  const auth = useMemo(() => new AuthClient({ baseUrl: Endpoint.auth }), []);

  return (
    <AuthFrame>
      {registered ? (
        <VerifyEmailNotice auth={auth} email={registered} verifyCallbackUrl="/verify-email" />
      ) : (
        <>
          {
            // Google first: one click against a form with four fields.
          }
          <SocialSignIn
            auth={auth}
            enabled={googleEnabled}
            githubEnabled={githubEnabled}
            callbackUrl="/"
            errorCallbackUrl="/sign-in"
          />
          <SignUpForm auth={auth} verifyCallbackUrl="/verify-email" onSuccess={setRegistered} />
          <Link to="/sign-in">{t("auth.haveAccount")}</Link>
        </>
      )}
    </AuthFrame>
  );
}
