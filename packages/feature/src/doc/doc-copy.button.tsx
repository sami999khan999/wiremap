import { useMessages } from "../i18n/index.js";
import { Button, Icon, useEffect, useState } from "../import.js";

export interface DocCopyButtonProps {
  readonly markdown: string;
}

// The page's source onto the clipboard, for pasting into an agent or an issue. Says so for
// two seconds and then goes back, so a second copy is not announced as the first.
export function DocCopyButton({ markdown }: DocCopyButtonProps) {
  const { t } = useMessages("doc");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    void navigator.clipboard.writeText(markdown).then(() => setCopied(true));
  };

  return (
    <Button variant="secondary" onClick={copy} aria-live="polite">
      <Icon name={copied ? "check" : "copy"} size={16} />
      {copied ? t("doc.copy.copied") : t("doc.copy.markdown")}
    </Button>
  );
}
