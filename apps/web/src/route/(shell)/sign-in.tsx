import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Endpoint } from "~/endpoint.js";
import {
  AuthClient,
  type ClientNamespace,
  SignInForm,
  SocialSignIn,
  TwoFactorForm,
  useMemo,
  useMessages,
  useState,
} from "~/import.js";
import { AuthFrame } from "~/route/-auth-frame.js";
import { LocaleSwitcher } from "~/route/-locale.js";
import { RedirectSearch } from "~/route/-redirect.js";
import { completeSignIn } from "~/route/-session.js";

// One local const referenced twice: `staticData` is what a prefetcher can read without
// executing anything, and deriving one from the other reaches into `ctx.route.options`.
const MESSAGES = ["auth"] as const satisfies readonly ClientNamespace[];

export const Route = createFileRoute("/(shell)/sign-in")({
  // `?redirect=/invitation/<token>` is how the landing page gets someone back to the
  // accept button. Validated to a rooted path — see `RedirectSearch`.
  validateSearch: RedirectSearch.schema,
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: SignInPage,
});

function SignInPage() {
  const { t } = useMessages("auth");
  const navigate = useNavigate();
  const router = useRouter();
  const search = Route.useSearch();
  const { session, googleEnabled, appearance, appearanceSnapshot } = Route.useRouteContext();
  // Which leg of the flow is on screen. The state lives here because neither form owns
  // the transition between them.
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  // Memoised: a bare `new` in the body builds a fresh Better Auth client, and a fresh
  // mutation identity, on every keystroke.
  const auth = useMemo(() => new AuthClient({ baseUrl: Endpoint.auth }), []);

  // The cookie exists now and nothing else knows, so invalidating both is what makes the
  // root ask again. `href`, because the destination is a validated string.
  const complete = () =>
    completeSignIn(
      session,
      () => router.invalidate(),
      () => void navigate({ href: RedirectSearch.target(search) }),
    );

  return (
    <AuthFrame>
      {
        // The one signed-out page that needs it: a reader who cannot read this form is
        // not going to find a switcher behind it.
      }
      <LocaleSwitcher appearance={appearance} current={appearanceSnapshot.locale} />
      {needsTwoFactor ? (
        <TwoFactorForm auth={auth} onSuccess={complete} />
      ) : (
        <>
          {
            // `googleEnabled` rides the session snapshot because `Env` is server-only,
            // and a button leading to an unconfigured provider is worse than no button.
          }
          <SocialSignIn
            auth={auth}
            enabled={googleEnabled}
            callbackUrl={RedirectSearch.target(search)}
            errorCallbackUrl="/sign-in"
          />
          <SignInForm
            auth={auth}
            onSuccess={complete}
            onNeedsTwoFactor={() => setNeedsTwoFactor(true)}
          />
          <nav>
            <Link to="/forgot-password">{t("auth.forgotPassword")}</Link>
            <Link to="/sign-up">{t("auth.noAccount")}</Link>
          </nav>
        </>
      )}
    </AuthFrame>
  );
}
