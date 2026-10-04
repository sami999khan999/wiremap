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
  "nav.sidebar": "Main navigation",
  "nav.workspace": "Workspace",
  "nav.dashboard": "Home",
  "nav.openMenu": "Open navigation",
  "nav.closeMenu": "Close navigation",
  "nav.resizeSidebar": "Resize the sidebar",
  "nav.backToProjects": "Projects",
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
  "nav.privacy.link": "Privacy",
  "nav.privacy.title": "Privacy",
  "nav.privacy.lead":
    "wiremap keeps a map of your code, never the code itself. This page says exactly what is kept, where, and for how long.",
  "nav.privacy.kept.title": "What is kept",
  "nav.privacy.kept.body":
    "Your account (name, email, sign-in sessions) and your organization, its members, roles and audit trail. Each project's settings and the names of the repositories it reads. For each scan: its branch, commit, counts and findings, and the graph itself: file paths, what kind of file each is, which files import which, exported names, HTTP routes with their file and line, and the URLs the frontend calls. Comments people write on the graph.",
  "nav.privacy.never.title": "What is never kept",
  "nav.privacy.never.body":
    "Source code. A scan clones a repository one commit deep onto a short-lived GitHub Actions runner, reads it there, uploads the graph, and the runner is discarded. GitHub access tokens are minted per scan, read-only and for one repository, and are never written down.",
  "nav.privacy.local.title": "Analyzing on your own machine",
  "nav.privacy.local.body":
    "The command wiremap analyze reads a folder and writes a file on your computer, and sends nothing anywhere. Only wiremap upload and wiremap scan send something, and what they send is the graph.",
  "nav.privacy.ask.title": "Ask, the AI assistant",
  "nav.privacy.ask.body":
    "Off unless an organization turns it on with its own Google Gemini key, which is stored encrypted and never shown again. A question sends the parts of the graph it is about, and up to eight of the files it names, fetched from GitHub at the scanned commit, to Google under that key. A fetched file is cached for at most ten minutes, and an answer for an hour.",
  "nav.privacy.where.title": "Where it lives",
  "nav.privacy.where.body":
    "The web app on Vercel; background jobs scheduled by Cloudflare; the database on Neon; the cache on Upstash; graphs on Backblaze B2, encrypted at rest; scans on GitHub Actions; email through an SMTP provider. Secrets you hand over (a model key, a webhook URL and its signing secret) are encrypted before they are stored.",
  "nav.privacy.delete.title": "Deleting it",
  "nav.privacy.delete.body":
    "Deleting a project removes its graphs, scans, findings, comments, saved views and access grants; the audit trail keeps a line saying it was deleted. Deleting an organization removes everything it holds. An export you asked for is kept for seven days.",
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
