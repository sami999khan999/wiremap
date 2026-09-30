import { useMessages } from "../i18n/index.js";
import {
  Callout,
  PlatformQueries,
  type RetentionPreviewDto,
  useApiClient,
  useAppQuery,
  useEffect,
  useState,
} from "../import.js";

// Long enough that typing "1", "12" does not ask twice, short enough that the answer is
// there before a hand reaches the save button.
const DEBOUNCE_MS = 300;

export interface RetentionPreviewNoticeProps {
  readonly tableName: string;
  // The value being typed, as a string, because that is what the input holds. An
  // unparseable one asks nothing and reports not-ready.
  readonly hotMonths: string;
  // Lifted, because the save button is the caller's and **it is disabled until a
  // preview for the current value has loaded**. That is the whole point of the item.
  readonly onReady: (ready: boolean) => void;
  // Absent previews the table across every tenant. Present previews one tenant's
  // months, which is the only number a per-tenant override will ever act on.
  readonly organizationId?: string;
}

const parsed = (value: string): number | null => {
  const months = Number(value.trim());
  return Number.isInteger(months) && months >= 1 ? months : null;
};

export function RetentionPreviewNotice({
  tableName,
  hotMonths,
  onReady,
  organizationId,
}: RetentionPreviewNoticeProps) {
  const { t } = useMessages("platform");
  const client = useApiClient();
  const [settled, setSettled] = useState(() => parsed(hotMonths));

  // Debounced here rather than in the query: `useAppQuery` keys on the value, so a key
  // that changed per keystroke would be one cache entry per keystroke.
  useEffect(() => {
    const months = parsed(hotMonths);
    const timer = setTimeout(() => setSettled(months), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [hotMonths]);

  const preview = useAppQuery({
    ...PlatformQueries.retentionPreview(client, tableName, settled ?? 1, organizationId),
    enabled: settled !== null,
  });

  const ready = settled !== null && settled === parsed(hotMonths) && preview.isSuccess;

  useEffect(() => {
    onReady(ready);
  }, [ready, onReady]);

  if (settled === null) return <p>{t("platform.retention.preview.invalid")}</p>;
  if (preview.isPending) return <p>{t("platform.retention.preview.loading")}</p>;
  if (preview.isError) return <p>{t("platform.retention.preview.failed")}</p>;

  const data: RetentionPreviewDto = preview.data;
  if (data.totalPartitions === 0) return <p>{t("platform.retention.preview.none")}</p>;

  // `danger` rather than `warning`: this is the sentence that says rows are about to
  // leave, and it is the last thing between the number and the save.
  return (
    <Callout tone="danger">
      {t("platform.retention.preview.summary", {
        partitions: data.totalPartitions,
        rows: data.estimatedRows,
        bytes: data.bytes,
      })}
    </Callout>
  );
}
