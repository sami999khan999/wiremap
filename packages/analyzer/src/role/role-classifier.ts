import type { FileRole } from "../import.js";

// Path and name conventions, for files no framework plugin claimed. Order matters: the first
// rule that matches wins, so the specific ones come before the folder-wide ones.
const RULES: readonly (readonly [RegExp, FileRole])[] = [
  [
    /(\.|-|_)(test|spec|e2e)\.[cm]?[jt]sx?$|(^|\/)(__tests__|tests?|e2e|cypress|playwright)\/|Test\.php$/,
    "test",
  ],
  [/(^|\/)(database\/)?migrations?\//, "migration"],
  [/\.blade\.php$|(^|\/)resources\/views\//, "view"],
  [
    /(^|\/)[^/]*\.config\.[cm]?[jt]s$|(^|\/)config\/[^/]+\.(php|[cm]?[jt]s)$|(^|\/)(vite|next|nuxt|tailwind|postcss|babel|jest|vitest|eslint|webpack|rollup)\.config/,
    "config",
  ],
  [/\.d\.ts$|(\.|-)types?\.[cm]?ts$|(^|\/)(types|typings|interfaces)\//, "types"],
  [/\.controller\.[cm]?[jt]s$|(^|\/)Http\/Controllers\//, "controller"],
  [/\.resolver\.[cm]?[jt]s$/, "resolver"],
  [/\.gateway\.[cm]?[jt]s$/, "gateway"],
  [/\.repository\.[cm]?[jt]s$|(^|\/)Repositories\//, "repository"],
  [/\.entity\.[cm]?[jt]s$|(^|\/)entities\//, "entity"],
  [/\.dto\.[cm]?[jt]s$|(^|\/)dtos?\//, "dto"],
  [/\.module\.[cm]?[jt]s$/, "module"],
  [/\.guard\.[cm]?[jt]s$/, "guard"],
  [/\.interceptor\.[cm]?[jt]s$/, "interceptor"],
  [/\.pipe\.[cm]?[jt]s$/, "pipe"],
  [/\.filter\.[cm]?[jt]s$/, "filter"],
  [/\.middleware\.[cm]?[jt]s$|(^|\/)(Http\/)?Middleware\/|(^|\/)middlewares?\//, "middleware"],
  [/\.service\.[cm]?[jt]s$|(^|\/)Services\//, "service"],
  [/(^|\/)Models\/|\.model\.[cm]?[jt]s$|(^|\/)models\//, "model"],
  [/(^|\/)Http\/Requests\//, "request"],
  [/(^|\/)Jobs\/|\.job\.[cm]?[jt]s$|(^|\/)jobs\//, "job"],
  [/(^|\/)(Events|Listeners)\/|\.event\.[cm]?[jt]s$|(^|\/)events\//, "event"],
  [/(^|\/)Policies\/|\.policy\.[cm]?[jt]s$/, "policy"],
  [/(^|\/)routes\/[^/]+\.php$/, "route"],
  [/(^|\/)hooks?\/|(^|\/)use[A-Z][\w-]*\.[cm]?[jt]sx?$/, "hook"],
  [/(^|\/)(utils?|lib|libs|helpers?|shared)\//, "utility"],
  [/\.[jt]sx$|(^|\/)components?\//, "component"],
];

export class RoleClassifier {
  private constructor() {}

  public static classify(local: string): FileRole {
    for (const [pattern, role] of RULES) if (pattern.test(local)) return role;
    return "source";
  }
}
