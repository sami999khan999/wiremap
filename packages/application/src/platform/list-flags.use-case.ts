import type { FlagRecord, FlagRepository, FlagTarget } from "../flag/index.js";
import { FlagRegistry } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";

// A declared flag joined to its row, or a row the code no longer declares. The owner,
// expiry and description come from code; the switch and the targets from the database.
export interface FlagSummary {
  readonly key: string;
  readonly owner: string | null;
  readonly expiresOn: string | null;
  readonly description: string | null;
  readonly isEnabled: boolean;
  readonly targets: readonly FlagTarget[];
  // A row whose declaration was deleted. The check ignores it; the screen shows it, so
  // somebody switches it off rather than wondering what it is.
  readonly orphaned: boolean;
  readonly updatedAt: Date | null;
}

// Every flag, server-only ones included. The only place a server-only flag's name leaves
// the server, and only to someone holding `platform.flag.read`.
export class ListFlagsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly flags: FlagRepository,
  ) {}

  public async execute(actor: Principal): Promise<readonly FlagSummary[]> {
    this.authorizer.assert(actor, "platform.flag.read");

    const registry = FlagRegistry.instance;
    const rows = new Map((await this.flags.findAll()).map((row) => [row.key, row]));

    const declared = registry.all().map((key): FlagSummary => {
      const meta = registry.meta(key);
      return ListFlagsUseCase.summary(key, rows.get(key), {
        owner: meta?.owner ?? null,
        expiresOn: meta?.expiresOn ?? null,
        description: meta?.description ?? null,
      });
    });

    const orphans = [...rows.values()]
      .filter((row) => !registry.isKnown(row.key))
      .map((row) =>
        ListFlagsUseCase.summary(row.key, row, { owner: null, expiresOn: null, description: null }),
      );

    return [...declared, ...orphans];
  }

  private static summary(
    key: string,
    row: FlagRecord | undefined,
    meta: Pick<FlagSummary, "owner" | "expiresOn" | "description">,
  ): FlagSummary {
    return {
      key,
      ...meta,
      isEnabled: row?.isEnabled ?? false,
      targets: row?.targets ?? [],
      orphaned: meta.owner === null,
      updatedAt: row?.updatedAt ?? null,
    };
  }
}
