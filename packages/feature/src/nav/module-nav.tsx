import { useMessages } from "../i18n/index.js";
import {
  type CapabilitySet,
  Icon,
  IconRegistry,
  type ModuleKey,
  ModuleRegistry,
  type NavItem,
  type ReactNode,
  useMemo,
} from "../import.js";

export interface ModuleNavProps {
  // Content, resolved by the caller's loader. Passed rather than fetched, so this
  // component stays synchronous and the shell decides when the request happens.
  readonly items: readonly NavItem[];
  readonly capabilities: CapabilitySet;
  // The shell owns navigation, so the link element arrives from `apps/web`. A `<Link>`
  // here would put the router in this package.
  readonly renderLink: (route: string, label: string, icon: ReactNode) => ReactNode;
}

// Two lists joined on `module`: content says what a menu holds and in what order,
// `ModuleRegistry` says who may see it. Neither can answer for the other.
export function ModuleNav({ items, capabilities, renderLink }: ModuleNavProps) {
  const { t } = useMessages("nav");

  const visible = useMemo(() => {
    const registry = ModuleRegistry.instance;
    // The gate decides membership, not the content row: an editor reordering a menu
    // cannot grant access, which is the whole reason `module` is the only join key.
    const allowed = new Set<string>(registry.visibleModules(capabilities));

    return items
      .filter((item) => allowed.has(item.module))
      .slice()
      .sort((a, b) => a.order - b.order);
  }, [items, capabilities]);

  return (
    // Labelled, because the shell renders a second `<nav>` for the account links and a
    // screen reader listing two unnamed navigations has told the reader nothing.
    <nav aria-label={t("nav.sections")}>
      {visible.map((item) => {
        const gate = ModuleRegistry.instance.gate(item.module as ModuleKey);
        // Validated, not cast: a content row is wide by design, and an unknown name
        // renders a `<use>` pointing at nothing rather than failing visibly.
        const icon = IconRegistry.isKnown(item.icon) ? <Icon name={item.icon} /> : null;

        return renderLink(gate.route, t(item.labelKey as Parameters<typeof t>[0]), icon);
      })}
    </nav>
  );
}
