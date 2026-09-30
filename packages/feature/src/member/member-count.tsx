import { useErrorMessage } from "../error/index.js";
import { useMessages } from "../i18n/index.js";
import { MemberQueries, useApiClient, useAppQuery } from "../import.js";

// The count alone, from the same paged procedure the list uses: `limit: 1` because
// `total` is what is wanted and a page of rows would be fetched and thrown away.
export function MemberCount() {
  const { t } = useMessages("nav");
  const shell = useMessages("common");
  const describe = useErrorMessage();
  const client = useApiClient();
  const members = useAppQuery(MemberQueries.list(client, { limit: 1, offset: 0 }));

  if (members.isPending) return <p>{shell.t("state.loading")}</p>;
  if (members.isError) return <p>{describe(members.error)?.message}</p>;

  return <p>{t("nav.home.members", { count: members.data.total })}</p>;
}
