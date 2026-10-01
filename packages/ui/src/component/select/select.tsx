import { cn } from "../../class-name/index.js";
import { BaseSelect, type IconName, type ReactNode } from "../../import.js";
import { usePortalContainer } from "../../theme/index.js";
import { Icon } from "../icon/index.js";
import { inputClassName } from "../input/index.js";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: IconName;
  readonly disabled?: boolean;
}

// `field` sits in a form and looks like `Input`; `menu` is the taller trigger that shows an
// option's icon, for a switcher in a sidebar.
export type SelectVariant = "field" | "menu";

export interface SelectProps {
  // The control's accessible name, spoken before the selected option's label.
  readonly label: string;
  readonly options: readonly SelectOption[];
  // `null` is controlled with nothing chosen; `undefined` leaves the value to the select.
  readonly value?: string | null;
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string) => void;
  // Set, and a hidden input carries the value, so a form reads it like a native select.
  readonly name?: string;
  readonly id?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly variant?: SelectVariant;
  // Which side the list opens on. `above` is for a trigger at the foot of a column, where
  // a list opening downwards lands under the fold.
  readonly placement?: "below" | "above";
  readonly className?: string;
  // Written by an enclosing `Field`, which clones them onto its one control.
  readonly "aria-describedby"?: string;
  readonly "aria-invalid"?: true;
  // For a list still loading: `disabled` alone says nothing about why.
  readonly "aria-busy"?: boolean;
}

const TRIGGER: Readonly<Record<SelectVariant, string>> = Object.freeze({
  field: "cursor-pointer items-center gap-2 text-left",
  menu: "flex min-h-(--control-height-lg) w-full cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-left font-medium text-fg text-sm [font:inherit] transition-colors duration-(--duration-fast) hover:bg-muted",
});

function content(option: SelectOption, description: boolean): ReactNode {
  return (
    <>
      {option.icon ? (
        <span className="ui-menu__icon inline-flex size-6 shrink-0 items-center justify-center rounded-sm border border-border bg-muted text-primary">
          <Icon name={option.icon} size={16} />
        </span>
      ) : null}
      <span className="ui-menu__text flex min-w-0 flex-col">
        <span className="ui-menu__label truncate">{option.label}</span>
        {description && option.description ? (
          <span className="ui-menu__description font-normal text-fg-muted text-xs">
            {option.description}
          </span>
        ) : null}
      </span>
    </>
  );
}

// A select that can show an icon and a second line, which a native `<select>` cannot. Base
// UI owns the listbox: arrow keys, Home and End, typeahead, Escape, and focus back out.
export function Select({
  label,
  options,
  value,
  defaultValue,
  onValueChange,
  name,
  id,
  required,
  disabled,
  variant = "field",
  placement = "below",
  className,
  ...association
}: SelectProps) {
  const container = usePortalContainer();
  const labels = Object.fromEntries(options.map((option) => [option.value, option.label]));

  return (
    <BaseSelect.Root
      items={labels}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange?.(next);
      }}
      name={name}
      id={id}
      required={required}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        {...association}
        className={cn(
          "ui-select ui-menu__trigger",
          variant === "field" ? inputClassName("flex") : null,
          TRIGGER[variant],
          className,
        )}
        render={(props, state) => {
          const selected = options.find((option) => option.value === state.value);
          return (
            <button
              {...props}
              type="button"
              aria-label={selected ? `${label}: ${selected.label}` : label}
            />
          );
        }}
      >
        <BaseSelect.Value>
          {(current: string | null) => {
            const selected = options.find((option) => option.value === current);
            return selected ? content(selected, false) : null;
          }}
        </BaseSelect.Value>
        <BaseSelect.Icon className="ui-menu__chevron ml-auto flex shrink-0 text-fg-muted">
          <Icon name="chevron-up-down" size={16} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal container={container}>
        <BaseSelect.Positioner
          side={placement === "above" ? "top" : "bottom"}
          align="start"
          sideOffset={4}
          alignItemWithTrigger={false}
          className="z-20"
        >
          <BaseSelect.Popup
            aria-label={label}
            className={cn(
              "ui-menu__list m-0 max-h-80 min-w-(--anchor-width) list-none overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-md outline-none",
              placement === "above" && "ui-menu__list--above w-max",
            )}
          >
            {options.map((option) => (
              <BaseSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="ui-menu__option flex cursor-pointer items-center gap-2 rounded-sm p-2 text-fg text-sm outline-none data-disabled:cursor-not-allowed data-highlighted:bg-muted data-disabled:opacity-50"
              >
                <BaseSelect.ItemText className="contents">
                  {content(option, true)}
                </BaseSelect.ItemText>
                <BaseSelect.ItemIndicator className="ui-menu__check ml-auto flex shrink-0 text-primary">
                  <Icon name="check" size={16} />
                </BaseSelect.ItemIndicator>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
