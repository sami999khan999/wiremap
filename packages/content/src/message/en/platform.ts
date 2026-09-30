export const platform = {
  "platform.title": "Platform",
  "platform.subtitle":
    "Settings above any one tenant. Held through a role in the platform organization, not through the tenant you are signed into.",
  "platform.status.title": "Status",
  "platform.organization": "Platform organization",
  // The slug, because the id is what an operator pastes into a query and the name is
  // what they recognise. Both, rather than a choice between them.
  "platform.organization.detail": "{name} ({slug})",
  "platform.health.title": "Dependencies",
  "platform.health.healthy": "Healthy",
  "platform.health.degraded": "Degraded",
  "platform.health.database": "Postgres",
  "platform.health.cache": "Redis — cache",
  "platform.health.queue": "Redis — queue",
  "platform.health.analytics": "ClickHouse",
  "platform.health.realtime": "Realtime fan-out",
  "platform.health.replica": "Postgres — replica",
  "platform.replica.lag": "Replica lag: {seconds} s",
  "platform.replica.title": "Replica reads",
  "platform.replica.on": "On",
  "platform.replica.off": "Off",
  "platform.replica.enable": "Route batch reads to the replica",
  "platform.replica.disable": "Read from the primary only",
  // The guarantee, stated, because "read from a replica" otherwise reads as "stale".
  "platform.replica.detail":
    "When on, the worker's batch reads — the analytics projection and its nightly reconciliation — use the replica. A read uses it only once it has caught up with the primary, and uses the primary otherwise.",
  "platform.state.up": "Up",
  "platform.state.down": "Down",
  // The third state, and the one that matters: absent is neither passing nor failing,
  // and a screen that showed "Down" here would report an outage nobody has.
  "platform.state.absent": "Not configured",

  // The organization field on the export and delete panels. Named for the storage page
  // they came from, which lite does not have.
  "platform.storage.filter": "Organization id",
  "platform.tenantExport.title": "Export a tenant",
  "platform.tenantExport.description":
    "One object per table the tenant owns, plus its catalog rows and a manifest of counts and checksums. API key and invitation hashes are redacted.",
  "platform.tenantExport.action": "Start export",
  "platform.tenantExport.queued":
    "Queued as {jobId}. Objects appear below once the worker finishes.",
  "platform.tenantExport.empty": "No export objects for this tenant.",
  // Two expiries, and they are not the same one: the link is minutes, the object is
  // days. Saying only the first would read as "download it whenever".
  "platform.tenantExport.expiry":
    "Download links expire in fifteen minutes; the objects themselves are deleted after seven days.",
  "platform.tenantDelete.title": "Delete a tenant",
  // Said before the fields: every month is archived first, so this is recoverable for
  // thirty days and then the nightly sweep removes the objects too.
  "platform.tenantDelete.warning":
    "Every month is archived to cold storage first, then the tenant's partitions and catalog rows are removed. The archived objects are deleted thirty days later.",
  "platform.tenantDelete.slug": "Type the slug to confirm",
  "platform.tenantDelete.slug.hint": "The server compares this too.",
  "platform.tenantDelete.action": "Delete tenant",
  // A job id, not a tally: the delete archives every month before it drops anything,
  // which for a large tenant is minutes the request no longer waits for.
  "platform.tenantDelete.queued":
    "Queued as {jobId}. Every month is archived before a partition is dropped.",

  "platform.flags.title": "Feature flags",
  // What the screen is, in one sentence: owner and expiry come from code, the switch from here.
  "platform.flags.description":
    "Each flag is declared in code with an owner and an expiry date, and switched here — for everyone, or only for the organizations listed under it.",
  "platform.flags.empty": "No flag is declared, and none is stored.",
  "platform.flags.column.flag": "Flag",
  "platform.flags.column.owner": "Owner",
  "platform.flags.column.expires": "Expires",
  "platform.flags.column.everyone": "Everyone",
  "platform.flags.column.organizations": "Also on for",
  "platform.flags.on": "On",
  "platform.flags.off": "Off",
  "platform.flags.enable": "Turn on for everyone",
  "platform.flags.disable": "Turn off for everyone",
  // An expired flag fails the build, so the screen says so before CI does.
  "platform.flags.expired": "Past its expiry date — retire it",
  "platform.flags.orphaned": "Not declared in code",
  "platform.flags.orphaned.detail":
    "The code no longer declares this flag, so nothing reads it. Turn it off to clear it.",
  "platform.flags.organizations.none": "None",
  "platform.flags.organization.label": "Organization id or slug",
  "platform.flags.organization.add": "Turn on for this organization",
  "platform.flags.organization.remove": "Turn off for {slug}",

  "platform.entitlements.title": "Plans and entitlements",
  // What the screen is for, and the one fact that makes a downgrade safe.
  "platform.entitlements.description":
    "A plan is the set of permissions an organization has paid for. Moving an organization to a smaller plan hides the rest from its roles without deleting them, so moving it back restores them.",
  "platform.plans.title": "Plans",
  "platform.plans.column.plan": "Plan",
  "platform.plans.column.permissions": "Permissions",
  "platform.plans.column.organizations": "Organizations",
  "platform.plans.every": "Every permission",
  "platform.plans.default": "New signups",
  "platform.plans.system": "Built in",
  "platform.plans.makeDefault": "Use for new signups",
  "platform.plans.edit": "Edit",
  "platform.plans.delete": "Delete",
  "platform.plans.new": "New plan",
  "platform.plan.key": "Key",
  "platform.plan.name": "Name",
  "platform.plan.description": "Description",
  "platform.plan.module": "All of {module}",
  // Why a box ticked itself, said where it happened.
  "platform.plan.closure":
    "Ticking a permission also ticks what it needs, and unticking one also unticks what depends on it.",
  "platform.plan.save": "Save plan",
  "platform.plan.cancel": "Cancel",
  "platform.entitlement.title": "One organization",
  "platform.entitlement.lookup": "Organization id or slug",
  "platform.entitlement.plan": "Plan",
  "platform.entitlement.assign": "Move to this plan",
  "platform.entitlement.summary": "Entitled to {count} permissions.",
  "platform.entitlement.role": "{role} holds {entitled} of the {listed} it lists.",
  "platform.entitlement.adjustments": "Adjustments",
  "platform.entitlement.adjustments.none": "None — the plan decides everything.",
  "platform.entitlement.column.permission": "Permission",
  "platform.entitlement.column.effect": "Effect",
  "platform.entitlement.column.reason": "Reason",
  "platform.entitlement.column.expires": "Expires",
  "platform.entitlement.never": "Never",
  "platform.entitlement.effect.add": "Added",
  "platform.entitlement.effect.remove": "Removed",
  "platform.entitlement.clear": "Clear",
  "platform.entitlement.adjust": "Adjust",
  "platform.entitlement.adjust.effect": "Effect",
  "platform.entitlement.adjust.reason": "Reason",
  "platform.entitlement.adjust.expires": "Expires (leave empty for permanent)",
  // A remove takes what depends on the key, which is otherwise a surprise.
  "platform.entitlement.adjusted": "Adjusted: {permissions}",
  "platform.modules.title": "Module switches",
  "platform.modules.description":
    "For an incident. A module switched off is gone for every organization, whatever its plan, until it is switched back on.",
  "platform.modules.on": "On",
  "platform.modules.off": "Off",
  "platform.modules.disable": "Switch off",
  "platform.modules.enable": "Switch back on",
  "platform.modules.reason": "Reason",

  // ── accounts (`AX6.8`) ──
  "platform.accounts.title": "Accounts",
  "platform.accounts.description":
    "Find an account by its address, see every organization it belongs to, and lock it everywhere at once when it is compromised.",
  "platform.account.lookup": "Email address",
  "platform.account.active": "Active",
  "platform.account.suspendedOn": "Suspended since {date}",
  "platform.account.memberships": "Organizations",
  "platform.account.memberships.none": "This account belongs to no organization.",
  "platform.account.column.organization": "Organization",
  "platform.account.column.role": "Role",
  "platform.account.column.permission": "Permission",
  "platform.account.column.reason": "Reason",
  "platform.account.deactivated": "Deactivated by the organization",
  "platform.account.reason": "Reason (every organization it belongs to can read it)",
  "platform.account.suspend": "Suspend everywhere",
  "platform.account.reinstate": "Reinstate",
  "platform.account.denies": "Denied by the platform",
  "platform.account.denies.none": "Nothing denied by the platform.",
  "platform.account.clear": "Clear",
  "platform.account.deny": "Deny",
  "platform.account.deny.organization": "In organization",
  "platform.account.denied": "Denied: {permissions}",
} as const;
