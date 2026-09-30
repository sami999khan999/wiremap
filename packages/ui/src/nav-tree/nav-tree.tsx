import { Icon } from "../icon/index.js";
import { type IconName, type ReactNode, useEffect, useId, useState } from "../import.js";

export type NavTreeKind = "section" | "page" | "link";

export interface NavTreeNode {
  readonly id: string;
  // `section` is a heading over its children, `page` a destination in this app, and
  // `link` one outside it, which opens as a plain anchor rather than through the router.
  readonly kind: NavTreeKind;
  readonly label: string;
  readonly href?: string;
  readonly icon?: IconName;
  readonly children?: readonly NavTreeNode[];
}

// What a caller's link element must carry for the stylesheet and assistive tech to see it.
// The router's `<Link>` is built outside this package, so the attributes travel to it.
export interface LinkAttributes {
  readonly className: string;
  readonly "aria-current"?: "page";
}

export type RenderNavLink = (
  node: NavTreeNode,
  content: ReactNode,
  attributes: LinkAttributes,
) => ReactNode;

export interface NavTreeProps {
  readonly label: string;
  readonly nodes: readonly NavTreeNode[];
  readonly renderLink: RenderNavLink;
  readonly activeId?: string;
  // Prefixes for the chevron's name, followed by the page's label: "Expand Guides".
  readonly expandLabel: string;
  readonly collapseLabel: string;
  readonly className?: string;
}

interface BranchProps {
  readonly node: NavTreeNode;
  readonly activeId: string | undefined;
  readonly renderLink: RenderNavLink;
  readonly expandLabel: string;
  readonly collapseLabel: string;
}

function contains(node: NavTreeNode, id: string | undefined): boolean {
  if (id === undefined) return false;
  return node.children?.some((child) => child.id === id || contains(child, id)) ?? false;
}

function content(node: NavTreeNode): ReactNode {
  return (
    <>
      {node.icon ? <Icon name={node.icon} size={16} className="ui-nav-tree__icon" /> : null}
      <span className="ui-nav-tree__label">{node.label}</span>
      {node.kind === "link" ? (
        <Icon name="external" size={14} className="ui-nav-tree__external" />
      ) : null}
    </>
  );
}

function link(node: NavTreeNode, activeId: string | undefined, renderLink: RenderNavLink) {
  const active = node.id === activeId;
  const attributes: LinkAttributes = {
    className: ["ui-nav-tree__link", active ? "ui-nav-tree__link--active" : null]
      .filter(Boolean)
      .join(" "),
    ...(active ? { "aria-current": "page" as const } : {}),
  };

  // Outside the app, so no router: a `<Link>` to another origin is a full navigation anyway.
  if (node.kind === "link") {
    return (
      <a href={node.href} className={attributes.className} target="_blank" rel="noreferrer">
        {content(node)}
      </a>
    );
  }

  return renderLink(node, content(node), attributes);
}

function Branch({ node, activeId, renderLink, expandLabel, collapseLabel }: BranchProps) {
  const holdsActive = contains(node, activeId);
  const [open, setOpen] = useState(holdsActive);
  const listId = useId();

  // Navigating into a closed branch opens it. Never closes one: the reader opened it.
  useEffect(() => {
    if (holdsActive) setOpen(true);
  }, [holdsActive]);

  const children = node.children ?? [];

  if (node.kind === "section") {
    return (
      <li className="ui-nav-tree__section">
        <p className="ui-nav-tree__heading">{node.label}</p>
        <Level
          nodes={children}
          activeId={activeId}
          renderLink={renderLink}
          expandLabel={expandLabel}
          collapseLabel={collapseLabel}
        />
      </li>
    );
  }

  if (children.length === 0) {
    return <li className="ui-nav-tree__item">{link(node, activeId, renderLink)}</li>;
  }

  const toggle = (
    <button
      type="button"
      className="ui-nav-tree__toggle"
      aria-expanded={open}
      aria-controls={listId}
      aria-label={`${open ? collapseLabel : expandLabel} ${node.label}`}
      onClick={() => setOpen((was) => !was)}
    >
      <Icon name="chevron-right" size={16} />
    </button>
  );

  return (
    <li className="ui-nav-tree__item">
      <div className="ui-nav-tree__row">
        {
          // A page with no destination of its own is only a folder, and then the whole
          // row is the toggle rather than a link that goes nowhere.
        }
        {node.href ? (
          link(node, activeId, renderLink)
        ) : (
          <button
            type="button"
            className="ui-nav-tree__link"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((was) => !was)}
          >
            {content(node)}
          </button>
        )}
        {node.href ? toggle : null}
      </div>
      <div id={listId} className="ui-nav-tree__children" hidden={!open}>
        <Level
          nodes={children}
          activeId={activeId}
          renderLink={renderLink}
          expandLabel={expandLabel}
          collapseLabel={collapseLabel}
        />
      </div>
    </li>
  );
}

function Level({
  nodes,
  activeId,
  renderLink,
  expandLabel,
  collapseLabel,
}: Omit<BranchProps, "node"> & { readonly nodes: readonly NavTreeNode[] }) {
  return (
    <ul className="ui-nav-tree__list">
      {nodes.map((node) => (
        <Branch
          key={node.id}
          node={node}
          activeId={activeId}
          renderLink={renderLink}
          expandLabel={expandLabel}
          collapseLabel={collapseLabel}
        />
      ))}
    </ul>
  );
}

// A documentation-style tree: headed sections, collapsible pages, and one active leaf.
// The link element is the caller's, so the router stays outside this package.
export function NavTree({
  label,
  nodes,
  renderLink,
  activeId,
  expandLabel,
  collapseLabel,
  className,
}: NavTreeProps) {
  return (
    <nav aria-label={label} className={["ui-nav-tree", className].filter(Boolean).join(" ")}>
      <Level
        nodes={nodes}
        activeId={activeId}
        renderLink={renderLink}
        expandLabel={expandLabel}
        collapseLabel={collapseLabel}
      />
    </nav>
  );
}
