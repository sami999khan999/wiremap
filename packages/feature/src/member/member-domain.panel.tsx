import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  DataTable,
  type DomainDto,
  EmptyState,
  Field,
  Input,
  MemberMutations,
  MemberQueries,
  Select,
  type TableColumn,
  useApiClient,
  useAppQuery,
  useState,
} from "../import.js";
import { useAssignableRoles } from "./use-assignable-roles.js";

export interface MemberDomainPanelProps {
  // Whether the viewer may add and remove; the list itself is any member's to read.
  readonly editable: boolean;
}

// The three refusals the server names by rule, each with its own sentence.
const RULE_COPY = {
  publicDomain: "member.domains.publicDomain",
  notYourDomain: "member.domains.notYourDomain",
} as const;

export function MemberDomainPanel({ editable }: MemberDomainPanelProps) {
  const { t } = useMessages("member");
  const describe = useErrorMessage();
  const client = useApiClient();
  const roles = useAssignableRoles();
  const domains = useAppQuery(MemberQueries.domains(client, { limit: 50, offset: 0 }));
  const add = MemberMutations.useAddDomain(client);
  const remove = MemberMutations.useRemoveDomain(client);
  const [domain, setDomain] = useState("");
  const [roleId, setRoleId] = useState<string | null>(null);
  const chosenRole = roleId ?? roles.assignable.find((role) => role.key === "member")?.id ?? null;

  const refusal = describe(add.error ?? remove.error);
  const rule = refusal?.envelope.fields?.[0]?.rule as keyof typeof RULE_COPY | undefined;
  const refusalCopy =
    rule && RULE_COPY[rule]
      ? t(RULE_COPY[rule])
      : refusal?.envelope.code === "CONFLICT"
        ? t("member.domains.claimed")
        : refusal?.message;

  const columns: readonly TableColumn<DomainDto>[] = [
    {
      key: "domain",
      header: t("member.domains.domain"),
      cell: (row) => <span className="font-mono">{row.domain}</span>,
    },
    { key: "role", header: t("member.domains.role"), cell: (row) => row.roleName },
    ...(editable
      ? [
          {
            key: "actions",
            header: "",
            cell: (row: DomainDto) => (
              <Button
                variant="ghost"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ domainId: row.id })}
              >
                {t("member.domains.remove")}
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <section className="flex flex-col gap-4">
      <p className="m-0 text-sm text-fg-muted">{t("member.domains.intro")}</p>
      {editable ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!chosenRole || domain.trim() === "") return;
            add.mutate(
              { domain: domain.trim(), roleId: chosenRole as DomainDto["roleId"] },
              { onSuccess: () => setDomain("") },
            );
          }}
        >
          <Field label={t("member.domains.domain")} htmlFor="domain-name">
            <Input
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="acme.com"
            />
          </Field>
          <Field label={t("member.domains.role")} htmlFor="domain-role">
            <Select
              label={t("member.domains.role")}
              value={chosenRole}
              onValueChange={setRoleId}
              options={roles.assignable.map((role) => ({ value: role.id, label: role.name }))}
            />
          </Field>
          <Button type="submit" disabled={add.isPending}>
            {t("member.domains.add")}
          </Button>
        </form>
      ) : null}
      {refusal ? <Callout tone="danger">{refusalCopy}</Callout> : null}
      {domains.isPending ? (
        <DataTable.Skeleton rows={1} columns={2} />
      ) : (domains.data?.items.length ?? 0) === 0 ? (
        <EmptyState title={t("member.domains.empty")} />
      ) : (
        <DataTable
          columns={columns}
          rows={domains.data?.items ?? []}
          caption={t("member.domains.title")}
        />
      )}
    </section>
  );
}
