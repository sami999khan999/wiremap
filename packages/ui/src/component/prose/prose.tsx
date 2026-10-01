import {
  IconRegistry,
  type KeyboardEvent,
  type MouseEvent,
  spriteUrl,
  useEffect,
  useRef,
} from "../../import.js";

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

  // Rerun on a new `html`: React replaces the whole subtree then, buttons included. After
  // the first paint, while the browser is idle: a long page has hundreds of code blocks.
  useEffect(() => {
    const container = root.current;
    if (!container) return;

    const wire = () => {
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
      for (const tabs of container.querySelectorAll<HTMLElement>(".ui-tabs:not([data-enhanced])")) {
        Tabs.enhance(tabs);
      }
      for (const card of container.querySelectorAll<HTMLElement>(".ui-card[data-icon]")) {
        Cards.icon(card);
      }
    };

    if ("requestIdleCallback" in globalThis) {
      const handle = globalThis.requestIdleCallback(wire, { timeout: 1_000 });
      return () => globalThis.cancelIdleCallback(handle);
    }
    const handle = setTimeout(wire, 0);
    return () => clearTimeout(handle);
  }, [html, copyLabel]);

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const tab = target.closest<HTMLButtonElement>("[data-tab]");
    if (tab) return Tabs.select(tab);
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
    // biome-ignore lint/a11y/noStaticElementInteractions: a delegated handler, not a control.
    <div
      ref={root}
      className={["ui-prose", className].filter(Boolean).join(" ")}
      onClick={onClick}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => Tabs.key(event)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// Server HTML gives each tab as a titled panel, readable with no script. Once mounted the
// titles become a tablist: one panel shown, arrow keys and Home/End move between them.
class Tabs {
  private constructor() {}

  public static enhance(root: HTMLElement): void {
    const panels = [...root.querySelectorAll<HTMLElement>(":scope > .ui-tabs__panel")];
    if (panels.length === 0) return;
    const list = document.createElement("div");
    list.className = "ui-tabs__list";
    list.setAttribute("role", "tablist");
    const prefix = `ui-tabs-${Math.random().toString(36).slice(2, 8)}`;

    panels.forEach((panel, index) => {
      const title = panel.querySelector(":scope > .ui-tabs__title")?.textContent ?? "";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ui-tabs__tab";
      button.id = `${prefix}-tab-${index}`;
      button.dataset.tab = String(index);
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", `${prefix}-panel-${index}`);
      button.textContent = title;
      list.append(button);

      panel.id = `${prefix}-panel-${index}`;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", button.id);
    });

    root.prepend(list);
    root.dataset.enhanced = "";
    const first = list.querySelector<HTMLButtonElement>("[data-tab]");
    if (first) Tabs.select(first);
  }

  public static select(tab: HTMLButtonElement): void {
    const root = tab.closest(".ui-tabs");
    if (!root) return;
    for (const each of root.querySelectorAll<HTMLButtonElement>(
      ":scope > .ui-tabs__list > [data-tab]",
    )) {
      const on = each === tab;
      each.setAttribute("aria-selected", String(on));
      each.tabIndex = on ? 0 : -1;
      const panel = root.querySelector<HTMLElement>(`#${each.getAttribute("aria-controls") ?? ""}`);
      if (panel) panel.hidden = !on;
    }
  }

  public static key(event: KeyboardEvent<HTMLDivElement>): void {
    const tab =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("[data-tab]")
        : null;
    if (!tab?.parentElement) return;
    const tabs = [...tab.parentElement.querySelectorAll<HTMLButtonElement>("[data-tab]")];
    const at = tabs.indexOf(tab);
    const moves: Record<string, number> = {
      ArrowRight: (at + 1) % tabs.length,
      ArrowLeft: (at - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const next = tabs[moves[event.key] ?? -1];
    if (!next) return;
    event.preventDefault();
    Tabs.select(next);
    next.focus();
  }
}

// A card's icon arrives as a sprite name; one the sprite does not hold draws nothing.
class Cards {
  private constructor() {}

  public static icon(card: HTMLElement): void {
    const name = card.dataset.icon ?? "";
    if (!IconRegistry.isKnown(name) || card.querySelector(".ui-card__icon")) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `${spriteUrl}#${name}`);
    svg.append(use);
    const tile = document.createElement("span");
    tile.className = "ui-card__icon";
    tile.append(svg);
    card.prepend(tile);
  }
}
