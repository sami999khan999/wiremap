import type { IconName, ReactNode } from "../../import.js";
import { Icon } from "../icon/index.js";

export interface EmptyStateProps {
  readonly icon?: IconName;
  readonly title: string;
  readonly description?: string;
  // Part of the component rather than something a caller composes around it: an empty
  // state is an invitation to act.
  readonly action?: ReactNode;
}

// Every string arrives as a prop. No literals anywhere in `ui`, which is what keeps the
// design system translatable and testable with props alone.
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="ui-empty-state flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-12 text-center text-fg-muted">
      {icon ? <Icon name={icon} size={32} /> : null}
      <p className="ui-empty-state__title m-0 font-semibold text-fg text-lg">{title}</p>
      {description ? (
        <p className="ui-empty-state__description m-0 max-w-[42ch] text-fg-muted text-sm">
          {description}
        </p>
      ) : null}
      {action}
    </div>
  );
}
