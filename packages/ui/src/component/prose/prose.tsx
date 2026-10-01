import { type MouseEvent, useEffect, useRef } from "../../import.js";

export interface ProseProps {
  // Sanitised on the server when the page was published. This component trusts it, so
  // nothing that has not been through that sanitiser may reach this prop.
  readonly html: string;
  readonly copyLabel: string;
  readonly copiedLabel: string;
  readonly className?: string;
}

// How long "Copied" stays before the button says "Copy" again.
const CONFIRM_MS = 1_500;

// Rendered HTML, styled as an article. Code blocks gain a copy button after mount, all of
// them served by one handler on the container rather than a listener per button.
export function Prose({ html, copyLabel, copiedLabel, className }: ProseProps) {
  const root = useRef<HTMLDivElement>(null);

  // Rerun on a new `html`: React replaces the whole subtree then, buttons included.
  useEffect(() => {
    const container = root.current;
    if (!container) return;

    for (const pre of container.querySelectorAll("pre")) {
      if (pre.parentElement?.classList.contains("ui-code-block")) continue;

      const wrapper = document.createElement("div");
      wrapper.className = "ui-code-block";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ui-code-block__copy";
      button.dataset.copy = "";
      button.textContent = copyLabel;

      pre.replaceWith(wrapper);
      wrapper.append(button, pre);
    }
  }, [html, copyLabel]);

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("[data-copy]");
    const pre = button?.parentElement?.querySelector("pre");
    if (!button || !pre) return;

    void navigator.clipboard?.writeText(pre.textContent ?? "").then(() => {
      button.textContent = copiedLabel;
      setTimeout(() => {
        button.textContent = copyLabel;
      }, CONFIRM_MS);
    });
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the buttons inside are the controls.
    // biome-ignore lint/a11y/noStaticElementInteractions: a delegated handler, not a control.
    <div
      ref={root}
      className={["ui-prose", className].filter(Boolean).join(" ")}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
