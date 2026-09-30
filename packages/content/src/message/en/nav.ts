export const nav = {
  // ── the shell around every signed-in page ──
  // Here rather than in `auth` or `account`: the header and the settings sidebar render
  // on every signed-in page, and `nav` is the namespace that layout already loads.
  "nav.signOut": "Sign out",
  // Shown when the server refuses the sign-out: the session is still live, so the shell
  // must not act as though it is gone.
  "nav.signOutFailed": "Could not sign out. Please try again.",
  "nav.account": "Account",
  "nav.security": "Security",
  "nav.organization": "Organization",
  "nav.organizationNew": "New organization",
  // The first thing in the tab order, visible only while focused. Without it a keyboard
  // reader walks the whole header before reaching the page on every navigation.
  "nav.skip": "Skip to main content",
  // Names the second landmark. Two unlabelled `<nav>`s are announced as "navigation"
  // twice, which is worse than one.
  "nav.sections": "Sections",

  "nav.roles": "Roles",
  "nav.members": "Members",
  "nav.apiKeys": "API keys",
  "nav.documents": "Documents",
  "nav.messages": "Messages",
  "nav.notifications": "Notifications",
  "nav.analytics": "Activity",
  "nav.widgets": "Dashboard cards",
  "nav.platform": "Platform",
  "nav.docs": "Docs",

  // ── the home page ──
  "nav.home.title": "{organization}",
  // One sentence rather than two fields, because a translation may want the role and
  // the tenant in the other order.
  "nav.home.role": "You are {role} here.",
  // Not "{count} members": `Translator` interpolates and does not pluralise, so a
  // count of 1 would read "1 members" in every locale that inflects.
  "nav.home.members": "Members: {count}",
  "nav.home.signedOut": "Sign in to continue.",
  "nav.home.goToSignIn": "Sign in",
} as const;
