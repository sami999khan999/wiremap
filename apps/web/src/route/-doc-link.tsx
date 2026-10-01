import { Link, useRouter } from "@tanstack/react-router";
import { Identifiers, type LinkAttributes, type ReactNode, useEffect } from "~/import.js";

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

    const [location = ""] = href.split("#");
    const [root, first, ...rest] = location.split("/").filter(Boolean);
    // Branded ids, parsed and only on a manage path: a failed parse builds an error with a
    // stack, and a sidebar of 500 slugs spent half its server render doing that.
    const manage = root === "doc" && first === "manage";
    const spaceId = manage ? Identifiers.docSpaceId.safeParse(rest[0]) : null;
    const pageId =
      manage && rest[1] !== undefined ? Identifiers.docPageId.safeParse(rest[1]) : null;
    if (spaceId?.success && pageId?.success) {
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
    if (spaceId?.success) {
      return (
        <Link to="/doc/manage/$spaceId" params={{ spaceId: spaceId.data }} {...props}>
          {content}
        </Link>
      );
    }
    // A reader link is a plain anchor that `useDocLinkNavigation` routes. A `<Link>` builds a
    // location as it renders, and a sidebar holds hundreds: a quarter of a page's server render.
    if ((root === "doc" || root === "docs") && first) {
      return (
        <a href={href} data-doc-link="" {...props}>
          {content}
        </a>
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

// One listener for every reader anchor: a plain left click navigates in the app, and a
// pointer or focus on one preloads it, as `<Link>`'s `intent` did. Modified clicks stay native.
export function useDocLinkNavigation(): void {
  const router = useRouter();

  useEffect(() => {
    const anchorOf = (event: Event): HTMLAnchorElement | null =>
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>("a[data-doc-link]")
        : null;
    const preloaded = new Set<string>();

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const href = anchorOf(event)?.getAttribute("href");
      if (!href) return;
      event.preventDefault();
      void router.navigate({ href });
    };
    const onIntent = (event: Event) => {
      const href = anchorOf(event)?.getAttribute("href");
      if (!href || preloaded.has(href)) return;
      preloaded.add(href);
      const [to = href, hash] = href.split("#");
      router.preloadRoute({ to, ...(hash ? { hash } : {}) } as never).catch(() => {
        preloaded.delete(href);
      });
    };

    document.addEventListener("click", onClick);
    document.addEventListener("pointerover", onIntent);
    document.addEventListener("focusin", onIntent);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("pointerover", onIntent);
      document.removeEventListener("focusin", onIntent);
    };
  }, [router]);
}
