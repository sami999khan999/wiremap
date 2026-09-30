import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  Field,
  type FormEvent,
  Input,
  RoleMutations,
  useApiClient,
  useState,
} from "../import.js";
import { useRoleFailure } from "./use-role-failure.js";

// A new role starts empty. Granting it anything is `rbac.permission.grant`, which is
// why this form has no permission picker.
export function CreateRoleForm() {
  const { t } = useMessages("role");
  // The role screens' own five refusals, because the catalog's generic CONFLICT
  // sentence is wrong about every one of them.
  const failureCopy = useRoleFailure();
  const client = useApiClient();
  const create = RoleMutations.useCreate(client);

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      // Empty is not a description, it is the absence of one, and `scope` is `org`
      // rather than a picker: nothing in the product writes `goal_members` yet.
      {
        key,
        name,
        description: description.trim() === "" ? null : description,
        scope: "org",
      },
      {
        onSuccess: () => {
          setKey("");
          setName("");
          setDescription("");
        },
      },
    );
  };

  const failure = failureCopy(create.error);

  return (
    <form onSubmit={submit} noValidate>
      <h2>{t("role.create.title")}</h2>

      <Field label={t("role.create.key")} htmlFor="role-key" hint={t("role.create.keyHint")}>
        <Input
          id="role-key"
          value={key}
          autoComplete="off"
          onChange={(event) => setKey(event.target.value)}
          required
        />
      </Field>

      <Field label={t("role.create.name")} htmlFor="role-name">
        <Input
          id="role-name"
          value={name}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
          required
        />
      </Field>

      <Field label={t("role.create.description")} htmlFor="role-description">
        <Input
          id="role-description"
          value={description}
          autoComplete="off"
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>

      {failure ? <Callout tone="danger">{failure}</Callout> : null}

      <Button type="submit" disabled={create.isPending || key === "" || name === ""}>
        {t("role.create.submit")}
      </Button>
    </form>
  );
}
