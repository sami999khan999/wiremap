import { useMessages } from "../i18n/index.js";

export interface TypingNoticeProps {
  // From `useConversationStream`, which owns the expiry: this renders and nothing else.
  readonly typing: readonly string[];
  // Null for a member nobody can name any more. Returning the id instead is the defect
  // `23.26b` filed: a frame carries a uuid and the notice used to print it.
  readonly nameFor?: (userId: string) => string | null;
}

export function TypingNotice({ typing, nameFor }: TypingNoticeProps) {
  const { t } = useMessages("messaging");

  if (typing.length === 0) return null;
  if (typing.length === 1) {
    const first = typing[0] ?? "";
    const name = nameFor?.(first) ?? t("messaging.member.unknown");
    return <p>{t("messaging.typing.one", { name })}</p>;
  }

  return <p>{t("messaging.typing.many")}</p>;
}
