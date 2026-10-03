import { ACTIVITY_ACTIONS } from "../catalog/index.js";
import { ActivityContract, type ActivityDto } from "./activity.contract.js";

export class ActivityEntity {
  private constructor(private readonly dto: ActivityDto) {}

  public static from(dto: ActivityDto): ActivityEntity {
    return new ActivityEntity(ActivityContract.entity.parse(dto));
  }

  // Every action a slice declares, for the audit log's filter, ordered by label. Read here
  // because the catalog itself is not exported from this package.
  public static actions(): readonly { readonly key: string; readonly label: string }[] {
    return Object.entries(ACTIVITY_ACTIONS as Record<string, { label: string }>)
      .map(([key, meta]) => ({ key, label: meta.label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  public get id(): string {
    return this.dto.id;
  }

  // The catalog's label, or the raw action for one no slice declares any more.
  public get label(): string {
    const known = (ACTIVITY_ACTIONS as Record<string, { label: string }>)[this.dto.action];
    return known?.label ?? this.dto.action;
  }
}
