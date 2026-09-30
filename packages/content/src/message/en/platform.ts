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

  "platform.retention.title": "Retention",
  "platform.retention.description":
    "How long each table keeps data in Postgres, and how long its archived months stay in object storage after that. A table with no row here uses the built-in default.",
  "platform.retention.table": "Table",
  "platform.retention.hotMonths": "Months in Postgres",
  "platform.retention.coldMonths": "Months in cold storage",
  "platform.retention.coldMonths.hint": "Blank never expires.",
  "platform.retention.mode": "When a month ages out",
  "platform.retention.mode.archive": "Archive, then drop",
  "platform.retention.mode.drop": "Drop",
  "platform.retention.save": "Save",
  "platform.retention.default": "Default",
  // Said plainly, because it is the one setting on this page that destroys data and
  // the word "drop" on a button does not carry it.
  "platform.retention.mode.warning":
    "A month dropped this way is not in cold storage and cannot be restored.",
  "platform.retention.neverDropped": "Never dropped — domain data.",
  "platform.retention.clickhouse": "ClickHouse",
  "platform.retention.clickhouse.months": "Months of analytics history",
  "platform.retention.preview.loading": "Working out what this would drop…",
  "platform.retention.preview.invalid": "Enter a whole number of months, at least one.",
  "platform.retention.preview.failed": "Could not work out what this would drop.",
  "platform.retention.preview.none": "The next run would drop nothing.",
  // Rows are the planner's estimate, refreshed by autovacuum — hence "about", which is
  // the honest word and not a hedge.
  "platform.retention.preview.summary":
    "The next run drops {partitions} partitions, about {rows} rows, {bytes} bytes.",
  "platform.tenantRetention.title": "One tenant's retention",
  "platform.tenantRetention.description":
    "Overrides the table's own numbers for one organization. Only tables the calendar already retires can be overridden.",
  "platform.tenantRetention.organization": "Organization id",
  // The asymmetry: hot months are exact because the tenant's month is its own
  // partition, and cold months are the worker's because a prefix rule cannot be.
  "platform.tenantRetention.organizationFirst":
    "Type an organization id to see what this would retire.",
  "platform.tenantRetention.coldNote":
    "Cold months shorter than the table's are enforced by the nightly run rather than by the bucket.",
  "platform.tenantRetention.saved": "Saved.",
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
  "platform.gaps.title": "Gaps",
  "platform.gaps.none": "Every archived month reached the analytics store.",
  "platform.gaps.row": "{period} — {tenants} archived objects never projected.",
  "platform.gaps.reproject": "Re-project this month",
  // Said once rather than per row: the reason is on a log line and is not stored, so
  // the screen can say a gap exists and not why.
  "platform.gaps.reason":
    "Why a month has a gap is on the log line, not in the row. Re-projecting is idempotent.",
  "platform.gaps.queued": "Queued as {jobId}; {objects} objects to read back.",
  "platform.switch.title": "Projection",
  "platform.switch.on": "On",
  "platform.switch.off": "Paused",
  "platform.switch.pause": "Pause projection",
  "platform.switch.resume": "Resume projection",
  "platform.switch.notConfigured": "Not configured",
  "platform.switch.notConfigured.detail":
    "This deployment runs no analytics store. Set CLICKHOUSE_URL to start one.",
  // The deadline, not just the consequence: a pause is recoverable only while the audit
  // table still holds the window, and after that only from cold storage.
  "platform.switch.deadline":
    "While paused, rows stop being projected. The audit table keeps {months} months; resume within that or fill the gap from cold storage.",
  "platform.switch.deadline.unbounded":
    "While paused, rows stop being projected. The audit table has no retention limit set, so the gap stays replayable.",
  "platform.projection.title": "Analytics projection",
  "platform.projection.description":
    "Which actions reach the analytics store, and for how long. Blank keeps an action for the default {months} months.",
  "platform.projection.loading": "Loading…",
  "platform.projection.notConfigured":
    "No analytics store is configured. The rows are saved and take effect when one is.",
  // Drift is what a screen reading only the rows would hide: a save that failed after
  // the commit would still read back as success.
  "platform.projection.drifted":
    "The store holds a different expression from these rows. The nightly run repairs it.",
  "platform.projection.saveTtl": "Save months",
  "platform.projection.stop": "Stop projecting",
  "platform.projection.resume": "Resume projecting",
  // The deadline, not just the consequence: past the Postgres window the gap can only
  // be filled from cold storage, and a screen that omits that reads as reversible.
  "platform.projection.excluded.warning":
    "Rows already in the store stay; new ones stop arriving. Past the audit table's retention window this gap can only be filled from cold storage.",
  "platform.storage.title": "Cold storage by tenant",
  // Said on the screen, not only in a doc: a partition holds one tenant's rows, but
  // the catalog reports size per table, so hot bytes have no tenant to belong to.
  "platform.storage.description":
    "Archived months only. Hot Postgres size cannot be attributed to a tenant; per-table hot size is on the retention screen.",
  "platform.storage.filter": "Organization id",
  "platform.storage.empty": "Nothing has been archived yet.",
  "platform.storage.column.organization": "Organization",
  "platform.storage.column.table": "Table",
  "platform.storage.column.bytes": "Size",
  "platform.storage.column.rows": "Rows",
  "platform.storage.column.months": "Months",
  "platform.storage.column.period": "Month",
  "platform.storage.column.actionCounts": "Actions",
  "platform.storage.column.projected": "Projected",
  // Null means ClickHouse never received this tenant-month — a recorded gap rather
  // than a blocked drop, which is why it has to be readable here.
  "platform.storage.notProjected": "Never",
  "platform.storage.months.title": "Archived months",
  "platform.restore.title": "Restore a month",
  // Both outcomes, because which applies is not the operator's to choose: inside the
  // hot window it goes live, outside it stays where retention will not fight it.
  "platform.restore.description":
    "Reads a month back out of cold storage. Inside the table's hot window it is attached and live again; outside it, it lands in a scratch table and stays there — raise the hot months first if you need it live.",
  "platform.restore.table": "Table",
  "platform.restore.period": "Month",
  "platform.restore.submit": "Restore",
  "platform.restore.queued": "Queued as {jobId}. {objects} objects to read back.",
  "platform.retention.drift":
    "The store holds something else. The nightly run will put this right; it now holds {actual}.",
  "platform.shards.title": "Shard map",
  // Counted out of the directory rather than out of the cluster: a node the deployment
  // has just added holds nothing, and so has no row here at all.
  "platform.shards.description":
    "One row per physical node, counted out of the directory. A tenant is placed once, when it is founded, and changes node only when a move job puts it somewhere else.",
  "platform.shards.empty": "The directory is empty — no tenant has been founded yet.",
  "platform.shards.column.node": "Node",
  "platform.shards.column.tenants": "Tenants",
  "platform.shards.column.lastAssigned": "Last placed",
  "platform.shards.column.lastMoved": "Last moved",
  // Null rather than a zero date: a node nothing has ever moved to has no such date,
  // and a made-up one reads as a move that happened.
  "platform.shards.never": "Never",
  "platform.shards.expand": "Show tenants",
  "platform.shards.collapse": "Hide tenants",
  "platform.shards.tenants.title": "Tenants on node {node}",
  "platform.shards.tenants.empty": "No tenant on this node.",
  "platform.shards.column.organization": "Organization",
  "platform.shards.column.assigned": "Placed",
  "platform.shards.column.overrides": "Retention",
  "platform.shards.column.actions": "Actions",
  "platform.shards.overrides.default": "Defaults",
  "platform.shards.overrides.count": "{count} overridden",
  "platform.shards.move": "Move",
  // Spelled out rather than hidden in a tooltip. The button is here so the screen is
  // honest about what is missing, and a reason nobody can read is not honest.
  "platform.shards.move.unavailable":
    "Tenant moves need a second database node — with one, there is nowhere to move a tenant to.",
  "platform.shards.move.title": "Move {name}",
  // The two costs of pressing the button, in the order the operator pays them.
  "platform.shards.move.warning":
    "{name} is on node {node}. Its writes are refused until every row is copied, and the old copy is kept for the grace period so the move can be undone.",
  "platform.shards.move.to": "Move to node {node}",
  "platform.shards.move.cancel": "Cancel",
  // Queued, not moved: the map still shows the old node until the worker flips it.
  "platform.shards.move.queued":
    "Queued as {jobId}. The tenant shows on its new node once the worker has copied every row.",
  "platform.shards.manage": "Storage and delete",
  "platform.shards.page": "{from}–{to} of {total}",
  "platform.shards.page.previous": "Previous",
  "platform.shards.page.next": "Next",
  "platform.shards.lookup.title": "Find a tenant",
  "platform.shards.lookup.label": "Organization id or slug",
  // A miss is what a typed search usually is, so this is a sentence rather than an error.
  "platform.shards.lookup.empty": "No tenant answers to that.",
  "platform.shards.lookup.found": "{name} ({slug}) is on node {node}.",

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
