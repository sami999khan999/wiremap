import { Link } from "@tanstack/react-router";
import { Identifiers, type LinkAttributes, type ReactNode } from "~/import.js";

// The doc components hand back plain hrefs, since `feature` has no router. This turns one
// into the typed route it names, so a click is a client navigation rather than a reload.
export class DocLink {
  private constructor() {}

  // An arrow, so it can be handed over as `renderLink={DocLink.render}` with no `this`.
  public static readonly render = (
    href: string,
    content: ReactNode,
    attributes: LinkAttributes,
  ): ReactNode => {
    const props = {
      ...(attributes.className ? { className: attributes.className } : {}),
      ...(attributes["aria-current"] ? { "aria-current": attributes["aria-current"] } : {}),
    };

    // An author's link out of the docs. `noreferrer`, since the page it leaves may be private.
    if (/^https?:\/\//.test(href)) {
      return (
        <a href={href} target="_blank" rel="noreferrer" {...props}>
          {content}
        </a>
      );
    }

    const [location = "", hash] = href.split("#");
    const [root, first, ...rest] = location.split("/").filter(Boolean);
    // Parsed rather than cast: the manage routes take branded ids, and a malformed one
    // falls through to the plain anchor at the bottom.
    const spaceId = Identifiers.docSpaceId.safeParse(rest[0]);
    const pageId = Identifiers.docPageId.safeParse(rest[1]);
    if (root === "doc" && first === "manage" && spaceId.success && pageId.success) {
      return (
        <Link
          to="/doc/manage/$spaceId/$pageId"
          params={{ spaceId: spaceId.data, pageId: pageId.data }}
          {...props}
        >
          {content}
        </Link>
      );
    }
    if (root === "doc" && first === "manage" && spaceId.success) {
      return (
        <Link to="/doc/manage/$spaceId" params={{ spaceId: spaceId.data }} {...props}>
          {content}
        </Link>
      );
    }
    if (root === "doc" && first) {
      return (
        <Link
          to="/doc/$space/$"
          params={{ space: first, _splat: rest.join("/") }}
          {...(hash ? { hash } : {})}
          {...props}
        >
          {content}
        </Link>
      );
    }
    if (root === "docs" && first) {
      return (
        <Link
          to="/docs/$space/$"
          params={{ space: first, _splat: rest.join("/") }}
          {...(hash ? { hash } : {})}
          {...props}
        >
          {content}
        </Link>
      );
    }

    // Anything else is a plain anchor: correct, only not client-routed.
    return (
      <a href={href} {...props}>
        {content}
      </a>
    );
  };
}
