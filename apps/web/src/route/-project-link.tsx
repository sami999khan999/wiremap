import { Link } from "@tanstack/react-router";
import type { LinkAttributes, ReactNode } from "~/import.js";

// The project components hand back plain hrefs, since `feature` has no router. The two
// shapes they produce, `/p/<slug>` and `/projects/new`, become typed links here.
export class ProjectLink {
  private constructor() {}

  public static readonly render = (
    href: string,
    content: ReactNode,
    attributes: LinkAttributes,
  ): ReactNode => {
    const className = attributes.className;
    const [, root, slug] = href.split("/");
    if (root === "p" && slug) {
      return (
        <Link to="/p/$project" params={{ project: slug }} className={className}>
          {content}
        </Link>
      );
    }
    return (
      <Link to="/projects/new" className={className}>
        {content}
      </Link>
    );
  };
}
