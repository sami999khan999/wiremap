import type { NavItem } from "../collection/index.js";
import type { ImageKey } from "../import.js";
import type { ResolvedMedia } from "../media/index.js";
import { type Namespace, SHELL_NAMESPACES } from "../message/index.js";
import type { Locale } from "../primitive/index.js";
import type { MessageSnapshot, Translator } from "../translator/index.js";

// The seam a CMS slots into. Four shapes: keyed strings, media references, repeating
// records, and long-form documents.
export abstract class ContentSource {
  // In every snapshot, from every implementation. Callers cannot opt out.
  public static readonly SHELL: readonly Namespace[] = SHELL_NAMESPACES;

  // `protected static`, so "`common` and `error` are always there" is a property of the
  // seam rather than of each call site.
  protected static resolve(requested: readonly Namespace[]): readonly Namespace[] {
    return [...new Set([...ContentSource.SHELL, ...requested])];
  }

  public abstract messages(
    locale: Locale,
    namespaces: readonly Namespace[],
  ): Promise<MessageSnapshot>;

  public abstract translator(locale: Locale, namespaces: readonly Namespace[]): Promise<Translator>;

  // Async even though the static implementation answers from memory: a CMS resolves this
  // over the network, and a signature change would reach every call site.
  public abstract media(key: ImageKey): Promise<ResolvedMedia>;

  // Shape 3: repeating records. `module` is the one field an editor cannot repoint,
  // because `ModuleRegistry` owns the gate.
  public abstract nav(): Promise<readonly NavItem[]>;
}
