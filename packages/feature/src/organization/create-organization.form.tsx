import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  Field,
  type FormEvent,
  Input,
  type OrganizationClient,
  OrganizationMutations,
  useState,
} from "../import.js";

export interface CreateOrganizationFormProps {
  readonly organization: OrganizationClient;
  // Runs once the new tenant exists and the session points at it. The call site clears
  // the cache and re-runs the root loader, as it does after a switch.
  readonly onCreated: () => void;
}

export function CreateOrganizationForm({ organization, onCreated }: CreateOrganizationFormProps) {
  const { t } = useMessages("organization");
  // Renders the code the server sent rather than one generic sentence: a 403 and a
  // 409 are different things to be told.
  const describe = useErrorMessage();
  const [name, setName] = useState("");
  const create = OrganizationMutations.useCreate(organization, onCreated);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({ name });
  };

  return (
    <form onSubmit={submit} noValidate>
      <Field
        label={t("organization.create.name")}
        htmlFor="organization-name"
        hint={t("organization.create.hint")}
      >
        <Input
          id="organization-name"
          autoComplete="organization"
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </Field>

      {create.isError ? <Callout tone="danger">{describe(create.error)?.message}</Callout> : null}

      <Button type="submit" disabled={create.isPending || name.trim().length === 0}>
        {t("organization.create.submit")}
      </Button>
    </form>
  );
}
