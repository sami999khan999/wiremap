import { Icon } from "../icon/index.js";
import type { IconName, ReactNode } from "../import.js";

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
    <div className="ui-empty-state">
      {icon ? <Icon name={icon} size={32} /> : null}
      <p className="ui-empty-state__title">{title}</p>
      {description ? <p className="ui-empty-state__description">{description}</p> : null}
      {action}
    </div>
  );
}
