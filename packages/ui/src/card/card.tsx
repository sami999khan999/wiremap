import { Icon } from "../icon/index.js";
import type { IconName, ReactNode } from "../import.js";
import type { LinkAttributes } from "../nav-tree/index.js";

export interface CardProps {
  readonly title: string;
  readonly description?: string;
  readonly icon?: IconName;
  // A card with a destination is a link as a whole: one target, not a title link plus a
  // body the pointer has to avoid.
  readonly href?: string;
  // The caller's router link. Absent, an `href` renders a plain anchor.
  readonly renderLink?: (href: string, content: ReactNode, attributes: LinkAttributes) => ReactNode;
  readonly children?: ReactNode;
}

export interface CardGridProps {
  readonly children: ReactNode;
  readonly className?: string;
}

// The same markup the Markdown renderer emits for `:::cards`, so a card written in a page
// and one composed in React are styled by one stylesheet.
export function Card({ title, description, icon, href, renderLink, children }: CardProps) {
  const content = (
    <>
      {icon ? (
        <span className="ui-card__icon">
          <Icon name={icon} size={16} />
        </span>
      ) : null}
      <span className="ui-card__title">{title}</span>
      {description ? <span className="ui-card__description">{description}</span> : null}
      {children}
    </>
  );

  if (href && renderLink) return renderLink(href, content, { className: "ui-card" });
  if (href) {
    return (
      <a className="ui-card" href={href}>
        {content}
      </a>
    );
  }
  return <div className="ui-card">{content}</div>;
}

export function CardGrid({ children, className }: CardGridProps) {
  return <div className={["ui-card-grid", className].filter(Boolean).join(" ")}>{children}</div>;
}
