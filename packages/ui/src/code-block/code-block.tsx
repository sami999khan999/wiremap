import { useEffect, useState } from "../import.js";

export interface CodeBlockProps {
  readonly code: string;
  // Shown above the code, never used to highlight it: highlighting happens on the server.
  readonly language?: string;
  readonly copyLabel: string;
  readonly copiedLabel: string;
}

const CONFIRM_MS = 1_500;

// The same `ui-code-block` shape `Prose` builds around a server-rendered `pre`, for code
// composed in React rather than written in a page.
export function CodeBlock({ code, language, copyLabel, copiedLabel }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => setCopied(true));
  };

  return (
    <div className="ui-code-block">
      {language ? <span className="ui-code-block__language">{language}</span> : null}
      <button type="button" className="ui-code-block__copy" onClick={copy}>
        {copied ? copiedLabel : copyLabel}
      </button>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
