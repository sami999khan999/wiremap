import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  Field,
  Input,
  PlatformMutations,
  PlatformQueries,
  type ProjectionEntryDto,
  useApiClient,
  useAppQuery,
  useMemo,
  useState,
} from "../import.js";

// One row per action, grouped by the slice it belongs to. The grouping is the action's
// own prefix, computed server-side so the fragments need not repeat their name.
export function ProjectionPolicyForm() {
  const { t } = useMessages("platform");
  const describe = useErrorMessage();
  const client = useApiClient();
  const policies = useAppQuery(PlatformQueries.projection(client));
  const update = PlatformMutations.useUpdateProjection(client);

  const grouped = useMemo(() => {
    const actions: readonly ProjectionEntryDto[] = policies.data?.actions ?? [];
    const groups = new Map<string, ProjectionEntryDto[]>();

    for (const entry of actions) {
      const group = groups.get(entry.module) ?? [];
      group.push(entry);
      groups.set(entry.module, group);
    }

    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [policies.data]);

  if (policies.isPending) return <p>{t("platform.projection.loading")}</p>;
  if (policies.isError) return <Callout tone="danger">{describe(policies.error)?.message}</Callout>;

  const data = policies.data;
  const drifted = data.configured && data.applied !== data.expected;

  return (
    <section>
      <h2>{t("platform.projection.title")}</h2>
      <p>{t("platform.projection.description", { months: data.defaultMonths })}</p>

      {!data.configured ? (
        <Callout tone="warning">{t("platform.projection.notConfigured")}</Callout>
      ) : null}
      {drifted ? <Callout tone="warning">{t("platform.projection.drifted")}</Callout> : null}

      {grouped.map(([module, entries]) => (
        <div key={module}>
          <h3>{module}</h3>
          {entries.map((entry) => (
            <ProjectionRow
              key={entry.action}
              entry={entry}
              defaultMonths={data.defaultMonths}
              onSave={(projected, ttlMonths) =>
                update.mutate({ action: entry.action, projected, ttlMonths })
              }
            />
          ))}
        </div>
      ))}

      {update.isError ? <Callout tone="danger">{describe(update.error)?.message}</Callout> : null}
    </section>
  );
}

interface ProjectionRowProps {
  readonly entry: ProjectionEntryDto;
  readonly defaultMonths: number;
  readonly onSave: (projected: boolean, ttlMonths: number | null) => void;
}

// Its own component because each row holds a months field: one `useState` per action
// in the parent would be twenty-one pieces of state and a re-render per keystroke.
function ProjectionRow({ entry, defaultMonths, onSave }: ProjectionRowProps) {
  const { t } = useMessages("platform");
  const [months, setMonths] = useState(entry.ttlMonths === null ? "" : String(entry.ttlMonths));

  const parsed = months.trim() === "" ? null : Number(months.trim());
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 1 && parsed <= 120);

  return (
    <div>
      <Field label={entry.label} htmlFor={`projection-${entry.action}`}>
        <Input
          id={`projection-${entry.action}`}
          type="number"
          min={1}
          max={120}
          placeholder={String(defaultMonths)}
          value={months}
          onChange={(event) => setMonths(event.target.value)}
        />
      </Field>

      <Button
        variant="secondary"
        disabled={!valid}
        onClick={() => onSave(entry.projected, valid ? parsed : null)}
      >
        {t("platform.projection.saveTtl")}
      </Button>

      {
        // Off is the destructive direction. The deadline is on the row below rather
        // than on the button, because it reads after the click as well as before.
        entry.projected ? (
          <Button variant="secondary" onClick={() => onSave(false, parsed)}>
            {t("platform.projection.stop")}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => onSave(true, parsed)}>
            {t("platform.projection.resume")}
          </Button>
        )
      }

      {entry.projected ? null : (
        <Callout tone="danger">{t("platform.projection.excluded.warning")}</Callout>
      )}
    </div>
  );
}
