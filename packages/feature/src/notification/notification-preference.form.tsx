import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Callout,
  DataTable,
  NotificationMutations,
  type NotificationPreferenceDto,
  NotificationQueries,
  useApiClient,
  useAppQuery,
} from "../import.js";

// Three choices as one joined control rather than a `Select`: a person sees them without
// opening anything, and each one saves on its own.
const MODES = ["immediate", "digest", "off"] as const;

export function NotificationPreferenceForm() {
  const { t } = useMessages("notification");
  const describe = useErrorMessage();
  const client = useApiClient();
  const preferences = useAppQuery(NotificationQueries.preferences(client));
  const update = NotificationMutations.useUpdatePreference(client);

  if (preferences.isPending) return <DataTable.Skeleton columns={2} rows={2} />;
  if (preferences.isError) {
    return <Callout tone="danger">{describe(preferences.error)?.message}</Callout>;
  }

  // One panel per category, with its channels as rows inside it.
  const categories = new Map<string, NotificationPreferenceDto[]>();
  for (const row of preferences.data.items as readonly NotificationPreferenceDto[]) {
    categories.set(row.category, [...(categories.get(row.category) ?? []), row]);
  }

  return (
    <>
      {[...categories].map(([category, rows]) => (
        <section key={category}>
          <h2>{t(`notification.preference.category.${category}` as never)}</h2>
          {rows.map((row) => {
            const channel = t(`notification.preference.channel.${row.channel}` as never);
            return (
              <fieldset key={row.channel} className="ui-setting">
                <legend className="sr-only">
                  {t(`notification.preference.category.${category}` as never)} · {channel}
                </legend>
                <span aria-hidden="true" className="text-sm text-fg">
                  {channel}
                </span>
                <div className="ui-segmented">
                  {MODES.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      // `aria-pressed` rather than a radio group: these save on click.
                      aria-pressed={row.mode === mode}
                      onClick={() =>
                        update.mutate({ category: row.category, channel: row.channel, mode })
                      }
                    >
                      {t(`notification.preference.mode.${mode}` as never)}
                    </button>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </section>
      ))}

      {update.isError ? <Callout tone="danger">{describe(update.error)?.message}</Callout> : null}
    </>
  );
}
