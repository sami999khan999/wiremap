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
  // The organization menu in the top bar: its trigger's name, its heading and its links.
  "nav.organizationMenu": "Switch organization",
  "nav.organizations": "Organizations",
  "nav.organizationSettings": "Organization settings",
  // The avatar menu's trigger.
  "nav.userMenu": "Your account",
  // The top bar's light, dark and system control. Lower case, as the bar writes them.
  "nav.mode": "Colour mode",
  "nav.modeSystem": "system",
  "nav.modeLight": "light",
  "nav.modeDark": "dark",
  "nav.product": "wiremap",
  // The settings sidebar: its name and its two groups.
  "nav.settings": "Settings",
  "nav.settingsYou": "You",
  "nav.settingsOrganization": "Organization",
  "nav.notificationSettings": "Notification settings",
  // The first thing in the tab order, visible only while focused. Without it a keyboard
  // reader walks the whole header before reaching the page on every navigation.
  "nav.skip": "Skip to main content",
  // Names the second landmark. Two unlabelled `<nav>`s are announced as "navigation"
  // twice, which is worse than one.
  "nav.sections": "Sections",

  "nav.roles": "Roles",
  "nav.members": "Members",
  "nav.apiKeys": "API keys",
  "nav.teams": "Teams",
  "nav.projects": "Projects",
  "nav.access": "Project access",
  "nav.ai": "AI",
  "nav.webhooks": "Webhooks",
  "nav.audit": "Audit log",
  "nav.documents": "Documents",
  "nav.notifications": "Notifications",
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
  // The landing page a signed-out visitor sees.
  "nav.landing.title": "See how your code is wired.",
  "nav.landing.lead":
    "Wiremap scans your repositories and draws the import graph by folder, every file's role, the routes your backend exposes and the frontend calls that reach them.",
  "nav.landing.start": "Get started",
  "nav.landing.graph.title": "The graph, by folder",
  "nav.landing.graph.body":
    "Folders you can open, files coloured by role, and the imports between them.",
  "nav.landing.routes.title": "Routes and where they live",
  "nav.landing.routes.body":
    "Every route with its method, path, file and line, matched to the calls that use it.",
  "nav.landing.insights.title": "What needs attention",
  "nav.landing.insights.body":
    "Cycles, unused files, routes with no auth guard, and what a change would touch.",
  "nav.landing.ask.title": "Ask about it",
  "nav.landing.ask.body":
    "Questions answered from the graph, with links to the real files. Your own Gemini key.",
  "nav.home.goToSignIn": "Sign in",
} as const;
