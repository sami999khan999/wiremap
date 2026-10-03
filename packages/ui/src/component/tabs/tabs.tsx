import { cn } from "../../class-name/index.js";
import { BaseTabs, type ReactNode } from "../../import.js";

export interface TabItem {
  readonly value: string;
  readonly label: string;
}

export interface TabsProps {
  // The tab list's accessible name.
  readonly label: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly items: readonly TabItem[];
  // The open tab's content. One render function, so a closed tab mounts nothing.
  readonly children: (value: string) => ReactNode;
  readonly className?: string;
}

// A segmented tab list over one panel, on Base UI: arrow keys move, Home and End jump.
// The chosen tab is --muted, like `ThemeToggle`: navigation chrome, not an action.
export function Tabs({ label, value, onValueChange, items, children, className }: TabsProps) {
  return (
    <BaseTabs.Root
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange(next);
      }}
      className={cn("ui-tabs flex min-h-0 flex-col", className)}
    >
      <BaseTabs.List
        aria-label={label}
        className="ui-tabs__list grid auto-cols-fr grid-flow-col gap-1 rounded-md border border-border bg-surface p-1"
      >
        {items.map((item) => (
          <BaseTabs.Tab
            key={item.value}
            value={item.value}
            className="ui-tabs__tab h-(--control-height-sm) cursor-pointer rounded-sm border-0 bg-transparent px-3 text-sm text-fg-muted transition-colors duration-(--duration-fast) hover:text-fg focus-visible:outline-2 focus-visible:outline-ring data-selected:bg-muted data-selected:text-fg"
          >
            {item.label}
          </BaseTabs.Tab>
        ))}
      </BaseTabs.List>
      <BaseTabs.Panel value={value} className="ui-tabs__panel min-h-0 flex-1 outline-none">
        {children(value)}
      </BaseTabs.Panel>
    </BaseTabs.Root>
  );
}
