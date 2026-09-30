import { type NavItem, navItems } from "../collection/index.js";
import type { ImageKey } from "../import.js";
import type { ResolvedMedia } from "../media/index.js";
import { StaticMediaResolver } from "../media/index.js";
import type { MessageBundle, Namespace } from "../message/index.js";
import { type BundleLoader, CLIENT_CATALOG, type MessageCatalog } from "../message/index.js";
import type { Locale } from "../primitive/index.js";
import { type MessageSnapshot, Translator } from "../translator/index.js";
import { ContentSource } from "./content-source.js";

export class StaticContentSource extends ContentSource {
  private readonly mediaResolver = new StaticMediaResolver();

  // Defaults to the client catalog. The server passes its own catalog explicitly.
  public constructor(private readonly catalog: MessageCatalog = CLIENT_CATALOG) {
    super();
  }

  // One bundle, and `base` stays empty. English used to load beneath every locale as a
  // fallback; `NamespaceBundle` is a total `Record`, so no shipped bundle can have the
  // ──
  // gap that layer covered, and a Bengali page carried 3 471 characters it could not read.
  // A CMS source is free to fill `base` — that is what the port is for. See `23.15`.
  public override async messages(
    locale: Locale,
    namespaces: readonly Namespace[],
  ): Promise<MessageSnapshot> {
    const wanted = ContentSource.resolve(namespaces);
    const overrides = await StaticContentSource.load(this.catalog[locale], wanted);

    return { locale, namespaces: wanted, base: {}, overrides };
  }

  public override async translator(
    locale: Locale,
    namespaces: readonly Namespace[],
  ): Promise<Translator> {
    return new Translator(await this.messages(locale, namespaces));
  }

  // Genuinely synchronous, so `Promise.resolve` rather than an `async` with no `await`
  // claiming an asynchrony these do not have.
  public override media(key: ImageKey): Promise<ResolvedMedia> {
    return Promise.resolve(this.mediaResolver.resolve(key));
  }

  public override nav(): Promise<readonly NavItem[]> {
    return Promise.resolve(navItems);
  }

  // Skipped rather than thrown on, which is how a client catalog structurally cannot
  // obtain server-only copy.
  private static async load(
    loaders: Partial<Record<Namespace, BundleLoader>>,
    namespaces: readonly Namespace[],
  ): Promise<MessageBundle> {
    const present = namespaces
      .map((namespace) => loaders[namespace])
      .filter((loader): loader is BundleLoader => loader !== undefined);

    const bundles = await Promise.all(present.map((loader) => loader()));
    return Object.assign({}, ...bundles) as MessageBundle;
  }
}
