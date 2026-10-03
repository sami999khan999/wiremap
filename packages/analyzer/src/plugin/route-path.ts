// Route paths written four ways, `:id`, `{id}`, `[id]` and `$id`, read as one: `:id`.
export class RoutePath {
  private constructor() {}

  public static join(...parts: readonly (string | null | undefined)[]): string {
    const joined = parts
      .filter((part): part is string => typeof part === "string" && part !== "")
      .join("/")
      .replace(/\/{2,}/g, "/");
    const path = RoutePath.normalise(joined.startsWith("/") ? joined : `/${joined}`);
    return path.length > 1 ? path.replace(/\/$/, "") : path;
  }

  public static normalise(path: string): string {
    return path
      .replace(/\{(\w+)\??\}/g, ":$1")
      .replace(/\[\[?\.\.\.(\w+)\]?\]/g, ":$1*")
      .replace(/\[(\w+)\]/g, ":$1")
      .replace(/(^|\/)\$(\w+)/g, "$1:$2")
      .replace(/(^|\/)\$(?=\/|$)/g, "$1*");
  }

  // `/users/:id` and `/users/:userId` are one route to a matcher: every parameter is `:param`.
  public static shape(path: string): string {
    return (
      RoutePath.normalise(path)
        .split("?")[0]
        ?.replace(/:\w+\*?/g, ":param")
        .replace(/\/$/, "") || "/"
    );
  }
}
