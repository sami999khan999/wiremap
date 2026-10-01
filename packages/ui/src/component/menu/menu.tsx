import { Select, type SelectOption } from "../select/index.js";

export type MenuOption = SelectOption;

export interface MenuProps {
  // The control's accessible name, spoken before the selected option's label.
  readonly label: string;
  readonly value: string;
  readonly options: readonly MenuOption[];
  readonly onSelect: (value: string) => void;
  // Which side the list opens on. `above` is for a trigger at the foot of a column, where
  // a list opening downwards lands under the fold.
  readonly placement?: "below" | "above";
  readonly className?: string;
}

// The switcher-sized `Select`: an icon and a second line per option, in a sidebar.
export function Menu({ label, value, options, onSelect, placement, className }: MenuProps) {
  return (
    <Select
      variant="menu"
      label={label}
      value={value}
      options={options}
      onValueChange={onSelect}
      placement={placement}
      className={className}
    />
  );
}
