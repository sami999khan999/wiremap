import { useMessages } from "../i18n/index.js";
import {
  type AccountClient,
  AccountMutations,
  Button,
  Callout,
  Field,
  type FormEvent,
  Input,
  useState,
} from "../import.js";

export interface ChangeEmailFormProps {
  readonly account: AccountClient;
  // Where the confirmation link lands. It goes to the *current* address, which the
  // server decides — this is only the destination once the token is spent.
  readonly callbackUrl: string;
}

export function ChangeEmailForm({ account, callbackUrl }: ChangeEmailFormProps) {
  const { t } = useMessages("account");
  const [newEmail, setNewEmail] = useState("");

  const change = AccountMutations.useChangeEmail(account);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // Cleared on success, so the button below is disabled until a different address is
    // typed: submitting the same one again sends a second link to the same inbox.
    change.mutate({ newEmail, callbackURL: callbackUrl }, { onSuccess: () => setNewEmail("") });
  };

  return (
    <form onSubmit={submit} noValidate>
      <Field label={t("account.newEmail")} htmlFor="new-email">
        <Input
          id="new-email"
          type="email"
          autoComplete="email"
          value={newEmail}
          onChange={(event) => setNewEmail(event.target.value)}
          required
        />
      </Field>

      {
        // Nothing has changed yet: a "saved" message here would be a lie until the link
        // in the old inbox is followed.
      }
      {change.isSuccess ? <Callout tone="info">{t("account.changeEmailSent")}</Callout> : null}

      <Button type="submit" disabled={change.isPending || newEmail.length === 0}>
        {t("account.changeEmail")}
      </Button>
    </form>
  );
}
