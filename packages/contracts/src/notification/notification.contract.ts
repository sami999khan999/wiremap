import { z } from "../import.js";
import { Identifiers, Keyset } from "../primitive/index.js";

// A closed enum, and it is a wire shape rather than an implementation detail: the client
// renders copy from `kind`, so adding one without copy is a compile error there.
const kind = z.enum(["member.joined", "member.role.changed"]);

// What a preference is set against. Coarser than `kind` on purpose — a person choosing
// how they are contacted is not choosing per message type, they are choosing per topic.
const category = z.enum(["membership"]);

const channel = z.enum(["in_app", "email"]);

// `digest` is "collect these and send one message a day"; `off` is "in-app only". The
// three are what a preferences grid offers per category and channel.
const mode = z.enum(["immediate", "digest", "off"]);

export class NotificationContract {
  private constructor() {}

  public static readonly kind = kind;
  public static readonly category = category;
  public static readonly channel = channel;
  public static readonly mode = mode;

  public static readonly entity = z.object({
    id: Identifiers.notificationId,
    kind,
    category,
    // The values the copy interpolates. Never the row itself: a snapshot here would be
    // read by a client that was never authorised for the thing it describes.
    params: z.record(z.string(), z.string()),
    // Where clicking it goes, as a declared route. Nullable because not every
    // notification has somewhere to be.
    link: z.string().nullable(),
    readAt: z.date().nullable(),
    createdAt: z.date(),
  });

  public static readonly archivedQuery = Keyset.query.extend({
    // The first of a month, which is what `partition_archive` stores. The UI offers
    // the months that exist rather than a date picker that mostly returns nothing.
    period: z.string().regex(/^\d{4}-\d{2}-01$/),
  });

  // Months that actually have an object for this tenant. Not a range: a gap between
  // two archived months is a month nobody wrote, and offering it would be a lie.
  public static readonly archivedMonth = z.object({
    period: z.string().min(1),
    rows: z.number().int(),
  });

  public static readonly listQuery = Keyset.query.extend({
    // The bell's own list, which is the only screen that wants it.
    unreadOnly: z.boolean().default(false),
  });

  // `createdAt` rides along as the partition hint. A wrong value is NOT_FOUND rather
  // than a scan of every month.
  public static readonly markRead = z.object({
    id: Identifiers.notificationId,
    createdAt: z.date(),
  });

  public static readonly unreadCount = z.object({
    // Capped in the repository rather than counted exactly: past a hundred the badge
    // says "99+" and the true number is a query nobody reads.
    count: z.number().int().nonnegative(),
  });

  public static readonly preference = z.object({
    category,
    channel,
    mode,
  });

  public static readonly preferenceUpdate = z.object({
    category,
    channel,
    mode,
  });
}

export type NotificationDto = z.infer<typeof NotificationContract.entity>;
export type ArchivedNotificationQuery = z.infer<typeof NotificationContract.archivedQuery>;
export type ArchivedMonthDto = z.infer<typeof NotificationContract.archivedMonth>;
export type NotificationKind = z.infer<typeof kind>;
export type NotificationCategory = z.infer<typeof category>;
export type NotificationChannel = z.infer<typeof channel>;
export type NotificationMode = z.infer<typeof mode>;
export type NotificationPreferenceDto = z.infer<typeof NotificationContract.preference>;
export type ListNotificationsInput = z.infer<typeof NotificationContract.listQuery>;
export type MarkNotificationReadInput = z.infer<typeof NotificationContract.markRead>;
export type UpdateNotificationPreferenceInput = z.infer<
  typeof NotificationContract.preferenceUpdate
>;
