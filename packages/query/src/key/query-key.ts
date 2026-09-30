// Every key mirrors its procedure path, parameters last — a paged key that omits them
// serves page 1 for every page. See docs/reference/mutations.md.
export class QueryKeys {
  private constructor() {}

  // `{ all() }` like every namespace below, so a call site reads the same everywhere and
  // adding a key under `session` needs no change at the four places that invalidate it.
  public static readonly session = {
    all: () => ["session"] as const,
  };

  // `all()` on every namespace, because TanStack matches by prefix — one call catches
  // every list and detail below it, and that is what makes invalidation trustworthy.

  // Not under `session`: these outlive a single session record, and nesting them would
  // refetch three lists every time a session is refreshed.
  public static readonly account = {
    all: () => ["account"] as const,
    accounts: () => ["account", "linked", "list"] as const,
    sessions: () => ["account", "session", "list"] as const,
  };

  public static readonly analytics = {
    all: () => ["analytics"] as const,
    activity: (days: number) => ["analytics", "activity", days] as const,
  };

  // Mirrors the two procedure groups. `reading` is keyed by slug and path, which is what
  // a reader has; the editor's keys are by id, which is what an author has.
  public static readonly doc = {
    all: () => ["doc"] as const,
    spaces: () => ["doc", "space", "list"] as const,
    space: (spaceId: string) => ["doc", "space", spaceId] as const,
    readings: () => ["doc", "read"] as const,
    reading: (space: string, path: string) => ["doc", "read", space, path] as const,
    trees: () => ["doc", "tree"] as const,
    tree: (spaceId: string) => ["doc", "tree", spaceId] as const,
    page: (pageId: string) => ["doc", "page", pageId] as const,
    revisions: (pageId: string) => ["doc", "page", pageId, "revisions"] as const,
    revision: (pageId: string, revisionNo: number) =>
      ["doc", "page", pageId, "revisions", revisionNo] as const,
    allGrants: () => ["doc", "grant"] as const,
    grants: (spaceId: string) => ["doc", "grant", spaceId] as const,
  };

  public static readonly widget = {
    all: () => ["widget"] as const,
    preferences: () => ["widget", "preferences"] as const,
    preferencesOf: (userId: string) => ["widget", "preferences", userId] as const,
  };

  public static readonly notification = {
    all: () => ["notification"] as const,
    // The cursor is *not* in the key. It lives in the page data, and a key that carried
    // it would make every page a separate cache entry nothing could invalidate together.
    list: (params: unknown) => ["notification", "list", params] as const,
    // Every list at once, whatever its filter: what a new notification can change.
    lists: () => ["notification", "list"] as const,
    archived: (params: unknown) => ["notification", "archived", params] as const,
    archivedMonths: () => ["notification", "archived", "month"] as const,
    // The bell's count is its own key rather than a field on the list: it is read on
    // every page and the list on one, so they cannot share a lifetime.
    unreadCount: () => ["notification", "unreadCount"] as const,
    preferences: () => ["notification", "preferences"] as const,
  };

  // Two namespaces rather than one: a conversation list and the messages inside one
  // change at different rates, and a send must not invalidate the whole inbox.
  public static readonly conversation = {
    all: () => ["conversation"] as const,
    list: (params: unknown) => ["conversation", "list", params] as const,
    lists: () => ["conversation", "list"] as const,
    get: (conversationId: string) => ["conversation", "get", conversationId] as const,
  };

  public static readonly message = {
    all: () => ["message"] as const,
    // The cursor is not in the key, as everywhere else: it lives in the page data, and a
    // key that carried it would make every page a separate entry nothing invalidates.
    list: (conversationId: string) => ["message", "list", conversationId] as const,
  };

  // Above the tenant, so nothing here is keyed by organization: switching tenants
  // does not change what a platform admin is looking at.
  public static readonly platform = {
    all: () => ["platform"] as const,
    status: () => ["platform", "status"] as const,
    retention: () => ["platform", "retention"] as const,
    // The typed value and the tenant are both in the key, because that is what the
    // answer is about: the same months over two tenants are two sets of partitions.
    retentionPreview: (table: string, months: number, organizationId?: string) =>
      ["platform", "retention", "preview", table, months, organizationId ?? null] as const,
    storage: (params: unknown) => ["platform", "storage", params] as const,
    projection: () => ["platform", "projection"] as const,
    policy: () => ["platform", "policy"] as const,
    gaps: () => ["platform", "projection", "gap"] as const,
    exports: (organizationId: string) => ["platform", "export", organizationId] as const,
    shardMap: (params: unknown) => ["platform", "shard", "map", params] as const,
    // The term is the key, because that is what the answer is about: two lookups of two
    // tenants are two answers, not one refetched.
    tenantLocation: (term: string) => ["platform", "shard", "tenant", term] as const,
    flags: () => ["platform", "flag", "list"] as const,
    plans: () => ["platform", "plan", "list"] as const,
    // The prefix every org's entitlement shares, so a plan edit invalidates them all.
    entitlements: () => ["platform", "entitlement"] as const,
    entitlement: (organization: string) => ["platform", "entitlement", organization] as const,
    modules: () => ["platform", "module", "list"] as const,
    // The prefix every looked-up account shares, so a suspend refreshes whichever is open.
    accounts: () => ["platform", "account"] as const,
    account: (email: string) => ["platform", "account", email] as const,
  };

  public static readonly rbac = {
    all: () => ["rbac"] as const,
    roles: (params: unknown) => ["rbac", "role", "list", params] as const,
    effective: (userId: string) => ["rbac", "effective", userId] as const,
    entitlement: () => ["rbac", "entitlement"] as const,
  };

  // Create and revoke both invalidate `all()`: the list is the only read, and a new
  // key changes it whichever way it changed.
  public static readonly apiKey = {
    all: () => ["apiKey"] as const,
    list: (params: unknown) => ["apiKey", "list", params] as const,
  };

  // One person's exceptions. `all()` is what every override write invalidates.
  public static readonly override = {
    all: () => ["override"] as const,
    list: (userId: string) => ["override", "list", userId] as const,
  };

  // Inviting and revoking both invalidate `all()`: an invitation becoming a membership
  // changes both lists at once.
  public static readonly member = {
    all: () => ["member"] as const,
    list: (params: unknown) => ["member", "list", params] as const,
    invitations: (params: unknown) => ["member", "invitation", "list", params] as const,
  };
}
