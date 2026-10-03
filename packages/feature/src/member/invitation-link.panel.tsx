import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  type CreatedInvitationLinkDto,
  DataTable,
  DateFormat,
  EmptyState,
  Field,
  Input,
  type InvitationLinkDto,
  MemberMutations,
  MemberQueries,
  Select,
  type TableColumn,
  useApiClient,
  useAppQuery,
  useState,
} from "../import.js";
import { useAssignableRoles } from "./use-assignable-roles.js";

export interface InvitationLinkPanelProps {
  // The absolute URL a token opens. A prop, because `feature` may not import routing.
  readonly linkFor: (token: string) => string;
}

const DAYS = [1, 7, 14, 30] as const;
const USES = ["unlimited", "1", "5", "10", "25", "100"] as const;

// Create, list and revoke shareable invitation links. The token is shown once, right after
// creating, because the server keeps only its digest.
export function InvitationLinkPanel({ linkFor }: InvitationLinkPanelProps) {
  const { t } = useMessages("member");
  const describe = useErrorMessage();
  const client = useApiClient();
  const roles = useAssignableRoles();
  const links = useAppQuery(MemberQueries.links(client, { limit: 50, offset: 0 }));
  const create = MemberMutations.useCreateLink(client);
  const revoke = MemberMutations.useRevokeLink(client);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [days, setDays] = useState<string>("7");
  const [uses, setUses] = useState<string>("unlimited");
  const [created, setCreated] = useState<CreatedInvitationLinkDto | null>(null);
  const [copied, setCopied] = useState(false);

  const chosenRole = roleId ?? roles.assignable.find((role) => role.key === "member")?.id ?? null;

  const columns: readonly TableColumn<InvitationLinkDto>[] = [
    { key: "role", header: t("member.links.role"), cell: (row) => row.roleName },
    {
      key: "uses",
      header: t("member.links.maxUses"),
      cell: (row) =>
        row.maxUses === null
          ? t("member.links.usesUnlimited", { uses: row.uses })
          : t("member.links.uses", { uses: row.uses, max: row.maxUses }),
    },
    {
      key: "expires",
      header: t("member.links.expires"),
      cell: (row) => DateFormat.day(row.expiresAt),
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <Button
          variant="ghost"
          disabled={revoke.isPending}
          onClick={() => revoke.mutate({ linkId: row.id })}
        >
          {t("member.links.revoke")}
        </Button>
      ),
    },
  ];

  const url = created ? linkFor(created.token) : null;
  const error = describe(create.error ?? revoke.error);

  return (
    <section className="flex flex-col gap-4">
      <p className="m-0 text-sm text-fg-muted">{t("member.links.intro")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("member.links.role")} htmlFor="link-role">
          <Select
            label={t("member.links.role")}
            value={chosenRole}
            onValueChange={setRoleId}
            options={roles.assignable.map((role) => ({ value: role.id, label: role.name }))}
          />
        </Field>
        <Field label={t("member.links.expires")} htmlFor="link-days">
          <Select
            label={t("member.links.expires")}
            value={days}
            onValueChange={setDays}
            options={DAYS.map((count) => ({
              value: String(count),
              label: t("member.links.days", { count }),
            }))}
          />
        </Field>
        <Field label={t("member.links.maxUses")} htmlFor="link-uses">
          <Select
            label={t("member.links.maxUses")}
            value={uses}
            onValueChange={setUses}
            options={USES.map((value) => ({
              value,
              label: value === "unlimited" ? t("member.links.unlimited") : value,
            }))}
          />
        </Field>
        <Button
          disabled={!chosenRole || create.isPending}
          onClick={() =>
            chosenRole &&
            create.mutate(
              {
                roleId: chosenRole as InvitationLinkDto["roleId"],
                expiresInDays: Number(days),
                maxUses: uses === "unlimited" ? null : Number(uses),
              },
              {
                onSuccess: (link) => {
                  setCreated(link);
                  setCopied(false);
                },
              },
            )
          }
        >
          {t("member.links.create")}
        </Button>
      </div>
      {url ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            readOnly
            value={url}
            aria-label={t("member.links.copy")}
            className="min-w-0 flex-1 font-mono"
          />
          <Button
            variant="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(url).then(() => setCopied(true));
            }}
          >
            {t("member.links.copy")}
          </Button>
          {copied ? (
            <span className="text-sm text-fg-muted">{t("member.links.copied")}</span>
          ) : null}
        </div>
      ) : null}
      {error ? <Callout tone="danger">{error.message}</Callout> : null}
      {links.isPending ? (
        <DataTable.Skeleton rows={2} columns={4} />
      ) : (links.data?.items.length ?? 0) === 0 ? (
        <EmptyState title={t("member.links.empty")} />
      ) : (
        <DataTable
          columns={columns}
          rows={links.data?.items ?? []}
          caption={t("member.links.title")}
        />
      )}
    </section>
  );
}
