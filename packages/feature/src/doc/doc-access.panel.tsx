import { useMessages } from "../i18n/index.js";
import {
  Callout,
  type DocAccessOptionsDto,
  type DocAccessRuleDto,
  DocQueries,
  Field,
  fieldClassName,
  Select,
  useApiClient,
  useAppQuery,
} from "../import.js";

type Link = keyof DocAccessRuleDto;

const LINKS: readonly Link[] = ["module", "permission", "flag", "plan"];

const OPTIONS: Readonly<Record<Link, keyof DocAccessOptionsDto>> = Object.freeze({
  module: "modules",
  permission: "permissions",
  flag: "flags",
  plan: "plans",
});

export const EMPTY_ACCESS: DocAccessRuleDto = Object.freeze({
  module: null,
  permission: null,
  flag: null,
  plan: null,
});

export interface DocAccessPanelProps {
  // Prefixes every control's id, so a space form and a page editor can share a screen.
  readonly id: string;
  readonly value: DocAccessRuleDto | null;
  readonly onChange: (value: DocAccessRuleDto | null) => void;
  // A space's rule applies to every page in it, which the hint says.
  readonly scope: "space" | "page";
  readonly disabled?: boolean;
}

// The four links a doc may follow, each "None" until set. A key the server no longer knows
// is shown as a warning rather than silently dropped, since it hides the doc from everyone.
export function DocAccessPanel({ id, value, onChange, scope, disabled }: DocAccessPanelProps) {
  const { t } = useMessages("doc");
  const client = useApiClient();
  const options = useAppQuery(DocQueries.accessOptions(client));
  const rule = value ?? EMPTY_ACCESS;

  const set = (link: Link, next: string) => {
    const updated = { ...rule, [link]: next === "" ? null : next };
    const empty = LINKS.every((key) => updated[key] === null);
    onChange(empty ? null : updated);
  };

  const unknown = options.data
    ? LINKS.flatMap((link) => {
        const key = rule[link];
        const known = options.data[OPTIONS[link]].some((option) => option.key === key);
        return key !== null && !known ? [key] : [];
      })
    : [];

  return (
    <fieldset className="ui-stack m-0 flex flex-col gap-3 rounded-md border border-border p-4">
      <legend className={fieldClassName.label}>{t("doc.access.legend")}</legend>
      <p className={fieldClassName.hint}>
        {t(scope === "space" ? "doc.access.spaceHint" : "doc.access.hint")}
      </p>
      {LINKS.map((link) => {
        const available = options.data?.[OPTIONS[link]] ?? [];
        // No flag is declared in lite yet, and a picker with only "None" says nothing.
        if (link === "flag" && options.data && available.length === 0 && rule.flag === null) {
          return null;
        }
        return (
          <Field key={link} label={t(`doc.access.${link}`)} htmlFor={`${id}-access-${link}`}>
            <Select
              id={`${id}-access-${link}`}
              label={t(`doc.access.${link}`)}
              value={rule[link] ?? ""}
              disabled={disabled || options.isPending}
              onValueChange={(next) => set(link, next)}
              options={[
                { value: "", label: t("doc.access.none") },
                ...available.map((option) => ({
                  value: option.key,
                  label:
                    option.label === option.key ? option.key : `${option.label} (${option.key})`,
                })),
              ]}
            />
          </Field>
        );
      })}
      {unknown.map((key) => (
        <Callout key={key} tone="warning">
          {t("doc.access.unknown", { key })}
        </Callout>
      ))}
    </fieldset>
  );
}
