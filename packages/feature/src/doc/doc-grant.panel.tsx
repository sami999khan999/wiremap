import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  DateFormat,
  type DocGrantKind,
  DocMutations,
  DocQueries,
  type DocSpaceId,
  Field,
  type FormEvent,
  fieldClassName,
  Input,
  readerClassName,
  Select,
  StatusBadge,
  useApiClient,
  useAppQuery,
  useState,
} from "../import.js";

export interface DocGrantPanelProps {
  readonly spaceId: DocSpaceId;
}

const KINDS: readonly DocGrantKind[] = ["organization", "user", "plan"];

// Who outside the platform may read one `granted` space, and the form that adds to it.
// The server resolves what was typed and says so when nothing answers to it.
export function DocGrantPanel({ spaceId }: DocGrantPanelProps) {
  const { t } = useMessages("doc");
  const describe = useErrorMessage();
  const client = useApiClient();
  const grants = useAppQuery(DocQueries.grants(client, spaceId));
  const save = DocMutations.useSaveGrant(client);
  const revoke = DocMutations.useRevokeGrant(client);

  const [kind, setKind] = useState<DocGrantKind>("organization");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState("");

  const now = Date.now();
  const items = grants.data?.items ?? [];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(
      {
        spaceId,
        kind,
        target,
        reason,
        // The end of the chosen day, so "ends on the 3rd" still reads on the 3rd.
        expiresAt: expires === "" ? null : new Date(`${expires}T23:59:59Z`),
      },
      {
        onSuccess: () => {
          setTarget("");
          setReason("");
          setExpires("");
        },
      },
    );
  };

  return (
    <section className="ui-stack flex flex-col gap-3" aria-labelledby={`doc-grants-${spaceId}`}>
      <h3 id={`doc-grants-${spaceId}`}>{t("doc.grant.title")}</h3>
      <p className={fieldClassName.hint}>{t("doc.grant.description")}</p>

      {items.length === 0 ? <p>{t("doc.grant.none")}</p> : null}
      <ul className="ui-stack flex flex-col gap-3">
        {items.map((grant) => {
          const expired = grant.expiresAt !== null && grant.expiresAt.getTime() <= now;
          return (
            <li key={grant.id} className={readerClassName.actions}>
              <StatusBadge tone={expired ? "neutral" : "accent"}>
                {t(`doc.grant.kind.${grant.kind}`)}
              </StatusBadge>
              <strong>{grant.label}</strong>
              <span className={fieldClassName.hint}>
                {expired
                  ? t("doc.grant.expired")
                  : grant.expiresAt
                    ? t("doc.grant.expiresOn", { date: DateFormat.day(grant.expiresAt) })
                    : t("doc.grant.forever")}
                {" · "}
                {grant.reason}
              </span>
              <Button
                variant="ghost"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate({ grantId: grant.id })}
              >
                {t("doc.grant.revoke")}
              </Button>
            </li>
          );
        })}
      </ul>

      <form onSubmit={submit} noValidate className="ui-stack flex flex-col gap-3">
        <Field label={t("doc.grant.kind")} htmlFor={`doc-grant-kind-${spaceId}`}>
          <Select
            id={`doc-grant-kind-${spaceId}`}
            label={t("doc.grant.kind")}
            value={kind}
            onValueChange={(next) => setKind(next as DocGrantKind)}
            options={KINDS.map((option) => ({
              value: option,
              label: t(`doc.grant.kind.${option}`),
            }))}
          />
        </Field>
        <Field
          label={t("doc.grant.target")}
          htmlFor={`doc-grant-target-${spaceId}`}
          hint={t(`doc.grant.target.${kind}`)}
        >
          <Input
            id={`doc-grant-target-${spaceId}`}
            value={target}
            type={kind === "user" ? "email" : "text"}
            onChange={(event) => setTarget(event.target.value)}
            maxLength={320}
          />
        </Field>
        <Field
          label={t("doc.grant.reason")}
          htmlFor={`doc-grant-reason-${spaceId}`}
          hint={t("doc.grant.reasonHint")}
        >
          <Input
            id={`doc-grant-reason-${spaceId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
          />
        </Field>
        <Field
          label={t("doc.grant.expires")}
          htmlFor={`doc-grant-expires-${spaceId}`}
          hint={t("doc.grant.expiresHint")}
        >
          <Input
            id={`doc-grant-expires-${spaceId}`}
            type="date"
            value={expires}
            onChange={(event) => setExpires(event.target.value)}
          />
        </Field>

        {(save.error ?? revoke.error) ? (
          <Callout tone="danger">{describe(save.error ?? revoke.error)?.message}</Callout>
        ) : null}

        <Button
          type="submit"
          disabled={save.isPending || target.trim() === "" || reason.trim() === ""}
        >
          {t("doc.grant.save")}
        </Button>
      </form>
    </section>
  );
}
