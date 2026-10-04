import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Endpoint } from "~/endpoint.js";
import {
  AuthClient,
  type ClientNamespace,
  SignUpForm,
  SocialSignIn,
  useMemo,
  useMessages,
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
  const navigate = useNavigate();
  const { googleEnabled, githubEnabled } = Route.useRouteContext();
  // Email verification notice commented out for immediate sign-in:
  // const [registered, setRegistered] = useState<string | null>(null);

  // Memoised: a bare `new` in the body builds a fresh client on every keystroke.
  const auth = useMemo(() => new AuthClient({ baseUrl: Endpoint.auth }), []);

  return (
    <AuthFrame
      title={t("auth.signUp")}
      subtitle="Join Wiremap to map, analyze, and inspect your codebases"
      badge="GET STARTED"
    >
      <SocialSignIn
        auth={auth}
        enabled={googleEnabled}
        githubEnabled={githubEnabled}
        callbackUrl="/"
        errorCallbackUrl="/sign-in"
      />
      <SignUpForm
        auth={auth}
        verifyCallbackUrl="/verify-email"
        onSuccess={() => void navigate({ to: "/sign-in" })}
      />
      <nav>
        <Link to="/sign-in">{t("auth.haveAccount")}</Link>
      </nav>
    </AuthFrame>
  );
}
