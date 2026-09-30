import { oc, z } from "../import.js";
import { Envelope, Keyset } from "../primitive/index.js";
import { NotificationContract } from "./notification.contract.js";

export class NotificationProcedures {
  private constructor() {}

  public static readonly list = oc
    .route({ method: "GET", path: "/notifications" })
    .input(NotificationContract.listQuery)
    .output(Keyset.page(NotificationContract.entity));

  // The same page shape as `list`, so the client renders it with the component it
  // already has. See packages/application/docs/reference/ports.md.
  public static readonly archived = oc
    .route({ method: "GET", path: "/notifications/archived" })
    .input(NotificationContract.archivedQuery)
    .output(Keyset.page(NotificationContract.entity));

  public static readonly archivedMonths = oc
    .route({ method: "GET", path: "/notifications/archived/months" })
    .output(z.array(NotificationContract.archivedMonth).readonly());

  // Its own procedure rather than a field on the list: the bell is on every page and the
  // list is on one, so they have different cache lifetimes and different call rates.
  public static readonly unreadCount = oc
    .route({ method: "GET", path: "/notifications/unread-count" })
    .output(NotificationContract.unreadCount);

  public static readonly markRead = oc
    .route({ method: "POST", path: "/notifications/{id}/read" })
    .input(NotificationContract.markRead)
    .output(Envelope.acknowledged);

  // Separate from `markRead` rather than an optional id: "clear everything" is a
  // different intent, and one endpoint doing both makes an accidental empty body do it.
  public static readonly markAllRead = oc
    .route({ method: "POST", path: "/notifications/read-all" })
    .output(Envelope.acknowledged);

  public static readonly preferences = oc
    .route({ method: "GET", path: "/notifications/preferences" })
    .output(Envelope.paginated(NotificationContract.preference));

  public static readonly updatePreference = oc
    .route({ method: "PUT", path: "/notifications/preferences" })
    .input(NotificationContract.preferenceUpdate)
    .output(Envelope.acknowledged);

  // The object the merge point in `procedure/index.ts` mounts. One place to add a
  // procedure to, rather than two.
  public static readonly all = {
    list: NotificationProcedures.list,
    archived: NotificationProcedures.archived,
    archivedMonths: NotificationProcedures.archivedMonths,
    unreadCount: NotificationProcedures.unreadCount,
    markRead: NotificationProcedures.markRead,
    markAllRead: NotificationProcedures.markAllRead,
    preferences: NotificationProcedures.preferences,
    updatePreference: NotificationProcedures.updatePreference,
  } as const;
}
